/**
 * 位置跟随器（机制 A：实时跟随编辑）。
 *
 * 问题：节点存的是静态行列快照，文件一改（上面加行/删行）就漂移了。
 * 本文件监听每次文本编辑，把位移换算后加到同文件节点上，保证
 * "活着的会话"里行号时刻新鲜。
 *
 * ── 和 symbol-utils.ts（机制 B：跳转时重定位）如何分工？──
 *
 *   A（本文件）：会话内的打字/粘贴/删除/撤销/格式化/重构，靠"算位移"，
 *      优点是精确到行（含注释里的位置、无符号文件也行），
 *      缺点是扩展关闭期间的改动（git pull、换分支）看不见。
 *   B：跳转那一刻按符号身份重新定位，覆盖 A 够不着的一切；
 *      缺点是无符号文件没法验证、符号删改后找不回来。
 *   两者都自愈回写（改完就地更新 node.line/column 并持久化），
 *   所以树越用越准。stale 的判定权统一归 B（见 mapPosition 的注释）。
 *
 * ── 性能：逐键输入会不会卡？──
 *
 * 事件先看"树里有没有这个文件的节点"，没有直接 return——
 * 你打字时 99% 的事件走这一行就结束了。有节点才做纯算术
 * （几次加减法），且有节点移动才 fire _treeChanged（刷新 + 500ms
 * 防抖持久化都是现有机制）。实测无感。
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { NavNode } from './nav-node';

/**
 * 单条文本改动（0-based，VSCode 原生口径）。
 *
 * range（start→end）：改动前被影响的范围。
 *   - 纯插入：start == end（空范围，文本"塞"在这一点）。
 *   - 纯删除：newText 为空字符串。
 *   - 替换：两者都有。
 * newText：替换成的新文本（删行就是 ''）。
 */
export interface TextChange {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  newText: string;
}

/** 换算后的位置（1-based，和 NavNode 同口径）。 */
export interface MappedPosition {
  line: number;
  column: number;
}

/**
 * 把一个 1-based 位置映射过一条改动（纯函数，不碰 VSCode API，可单测）。
 *
 * 坐标系：入参出参都是 1-based（NavNode 口径），内部转 0-based 计算，
 * 返回前 +1。别混——VSCode 的 Range/Position 全是 0-based。
 *
 * 三种情况（设位置 P，改动范围 [S, E)）：
 *
 *   1. P 严格在 S 之前 → 不动。
 *      注意"严格"：P 恰好等于 S 时不算"之前"（纯插入时文本塞在 P 前面，
 *      P 应该被推到新文本后面；删除时 P 正好在删除起点，留在原地）。
 *   2. P 在 E 之后（含等于 E）→ 整体平移：
 *      行 += 新增行数 − 删除行数；若 P 和 E 同行，列也要重算
 *      （删掉 E 之前的字符 / 插入了带换行的文本都会影响列）。
 *   3. P 落在 (S, E) 被删区间内 → 钳（clamp）到 S。
 *      锚点文本已经没了，位置"塌"到改动起点是最诚实的选择。
 *      故意不标 stale：用户可能马上 Ctrl+Z（撤销也是文本事件，
 *      对称地算回去就复原了）；stale 判定统一交给跳转时的重定位，
 *      那里有符号信息，判得准。
 *
 * 多条 change 按数组顺序逐条应用：VSCode 保证同一次事件的
 * contentChanges 按应用顺序排列且互不重叠，所以不用排序。
 */
export function mapPosition(line: number, column: number, change: TextChange): MappedPosition {
  // 转 0-based：pl/pc = 位置，sl/sc = 改动起点，el/ec = 改动终点。
  const pl = line - 1;
  const pc = column - 1;
  const { startLine: sl, startChar: sc, endLine: el, endChar: ec } = change;

  // 新文本占几行、改动终点映射到哪（都是 0-based）。
  // 举例：newText = "a\nb\n" → 2 个 '\n' → newLineCount = 2，
  // 最后一行是 '' → newEndChar = 0。
  const newLineCount = countNewlines(change.newText);
  const lastLineLen = change.newText.length - (change.newText.lastIndexOf('\n') + 1);
  const newEndLine = sl + newLineCount;
  const newEndChar = newLineCount > 0 ? lastLineLen : sc + change.newText.length;

  // ── 情况 1：严格在改动起点之前 → 不动 ──
  if (pl < sl || (pl === sl && pc < sc)) {
    return { line, column };
  }

  // ── 情况 2：在改动终点之后（含等于）→ 平移 ──
  if (pl > el || (pl === el && pc >= ec)) {
    const mappedLine = pl + (newEndLine - el);
    // 只有"P 和 E 同行"时列才受影响（删/增了同行前面的字符）：
    // 新列 = P 在 E 之后的偏移量，接在新终点后面。
    const mappedChar = pl === el ? pc - ec + newEndChar : pc;
    return { line: mappedLine + 1, column: mappedChar + 1 };
  }

  // ── 情况 3：落在被删区间内 → 钳到改动起点 ──
  return { line: sl + 1, column: sc + 1 };
}

/** 数字符串里有几个 '\n'（就是"新文本占几行"的行数增量）。 */
function countNewlines(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      count++;
    }
  }
  return count;
}

/**
 * 位置跟随器：订阅文档变化，实时修正树里同文件节点。
 *
 * 生命周期和拦截器/确认器对齐：activate() 订阅，deactivate() 取消。
 * disposables 自己持有（同一模式），扩展关闭时由 extension.ts 统一释放。
 * 行为不依赖任何用户设置，所以 activate() 无参数，设置变化时也不用重启。
 */
export class PositionTracker {
  /**
   * 文档监听器的释放句柄。
   * onDidChangeTextDocument 对"所有"文档生效（不管文件开没打开、
   * 是打字还是格式化还是重构批量改），所以一个订阅就够了。
   */
  private disposable: vscode.Disposable | null = null;

  /** @param tree 要修正的导航树（就地改 node.line/column，持久化走 _treeChanged）。 */
  constructor(private tree: NavTree) {}

  /** 开始监听文档变化。 */
  activate(): void {
    this.disposable = vscode.workspace.onDidChangeTextDocument((event) => {
      // 先把 VSCode 的 change 对象转成我们的 TextChange（0-based 口径一致，
      // 直接抄 range.start.line / character 和 change.text 即可）。
      const changes: TextChange[] = event.contentChanges.map((c) => ({
        startLine: c.range.start.line,
        startChar: c.range.start.character,
        endLine: c.range.end.line,
        endChar: c.range.end.character,
        newText: c.text,
      }));
      // _applyChanges 返回"有没有节点真的动了"：没动就不打扰 UI。
      // 返回 true 才 fire，失败/没命中时保持安静。
      if (this._applyChanges(event.document.uri.toString(), changes)) {
        vscode.commands.executeCommand('backtrace._treeChanged');
      }
    });
  }

  /** 停止监听。扩展停用时由 extension.ts 的 deactivate() 调用。 */
  deactivate(): void {
    this.disposable?.dispose();
    this.disposable = null;
  }

  /**
   * 把一组改动应用到树里该文件的节点（含调用点），返回是否真有移动。
   *
   * 公开给测试用（下划线开头是"测试钩子"的约定，生产代码不调它；
   * 生产入口是 activate() 里订阅的事件回调，走的也是这个函数）。
   *
   * 细节：
   *   - 整棵树走一遍：节点自身位置（uri 命中）+ 调用点位置（callerUri 命中）
   *     都要修。调用点多半在别的文件的一个函数体内，同样会漂。
   *   - stale 节点也照修：文件可能改回来（点它重试→复活），行号保鲜着，
   *     复活那一刻才有意义。
   *   - 不碰 stale 标记、不做符号验证——那是机制 B 的权责。
   *
   * @returns true = 至少一个数字变了（调用方据此决定要不要刷新 UI）
   */
  _applyChanges(uri: string, changes: TextChange[]): boolean {
    if (!this.tree.root || changes.length === 0) {
      return false;
    }
    let moved = false;
    // BFS 走全树：树一般只有几十个节点，全遍历比建索引简单得多，
    // 也比"按文件建 Map 并维护一致性"少一堆 bug 面。别过早优化。
    const queue: NavNode[] = [this.tree.root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      // 节点自身位置
      if (node.uri === uri) {
        const mapped = applyAll(node.line, node.column, changes);
        if (mapped.line !== node.line || mapped.column !== node.column) {
          node.line = mapped.line;
          node.column = mapped.column;
          moved = true;
        }
      }
      // 调用点位置（callerLine 可能为 null：根节点/老数据没有调用点，跳过）
      if (node.callerUri === uri && node.callerLine != null && node.callerColumn != null) {
        const mapped = applyAll(node.callerLine, node.callerColumn, changes);
        if (mapped.line !== node.callerLine || mapped.column !== node.callerColumn) {
          node.callerLine = mapped.line;
          node.callerColumn = mapped.column;
          moved = true;
        }
      }
      for (const child of node.children) {
        queue.push(child);
      }
    }
    return moved;
  }
}

/** 把多条 change 按顺序套在同一个位置上（每条的输出是下一条的输入）。 */
function applyAll(line: number, column: number, changes: TextChange[]): MappedPosition {
  let pos: MappedPosition = { line, column };
  for (const change of changes) {
    pos = mapPosition(pos.line, pos.column, change);
  }
  return pos;
}
