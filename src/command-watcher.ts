/**
 * 跳转确认器（以前叫"导航拦截器"，职责变了所以改名理解方式）。
 *
 * 只确认"查定义类"跳转并记入导航树：
 * Find 回车、Outline 点击、搜索结果点击等一律丢弃。
 *
 * ── 为什么它自己不能过滤？（新手必读）──
 *
 * 它监听的是 onDidChangeTextEditorSelection（光标选择变化事件），
 * 用 event.kind === Command 粗筛"命令触发的光标移动"。
 * 但 VSCode 的 TextEditorSelectionChangeKind 枚举只有 3 个值：
 * Keyboard（打字/方向键）、Mouse（鼠标点选）、Command（命令移动光标）。
 * 它不告诉我们"到底是哪个命令"——F12 和 Find 回车在这里长得一模一样。
 * 另外 VSCode 也没有稳定的"某个命令被执行了"监听 API，
 * 所以光靠这个文件永远分不清 F12 和 Find，必须有人帮忙。
 *
 * ── 和 definition-interceptor.ts 如何分工？──
 *
 *   1. 用户按 F12 → 拦截器先记下"意图"（调用点 + 候选目标）。
 *   2. VSCode 跳过去 → 光标动了 → 本文件被唤醒：
 *      a. kind 不是 Command → 打字/点选，直接忽略。
 *      b. 是扩展自己的后退/前进（isInternalNav）→ 忽略，避免自己记自己。
 *      c. 120ms 防抖：等光标停稳（过滤跳转中间态）。
 *      d. 拿着落点问拦截器 consumeIntentIfMatches：命中才是真跳转，
 *         用意图里的精确调用点记入 NavTree；没命中就是 Outline / Find，
 *         直接丢弃。
 *
 * ── 相对旧版删掉了什么？──
 *
 *   - lastKnownPosition / lastMousePosition / lastMouseAt 字段：没用了。
 *     调用点现在由拦截器精确提供，不再需要"跳转前光标在哪"快照，
 *     也不需要"300ms 内有没有 Mouse 事件"来推测 Ctrl+Click。
 *   - resolveCallerPosition()：同上，调用点不再靠猜。
 *   - _setTestState()：它是给 resolveCallerPosition 的测试钩子，一起删除。
 *     意图机制的测试钩子在 DefinitionInterceptor 上（_injectTestIntent 等）。
 *   - markInternalNav() / internalNavAt：死代码，从没被调用过。
 *     内部导航一直靠 navigate.ts 的模块级 isInternalNav 标志识别，这里只读它。
 *   - activate(config) 的 config 参数：从没被真正用过（只存不用），
 *     且确认器行为与用户设置无关（设置变化时只需改 tree.maxDepth），删掉。
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { DefinitionInterceptor } from './definition-interceptor';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';
import { getNodeContext } from './symbol-utils';
import { isInternalNav } from './commands/navigate';

/**
 * 暂存的跳转信息（等待防抖确认）。
 *
 * 注意：里面没有调用点！调用点在防抖结束、确认稳定后，
 * 才向拦截器"领取"（consumeIntentIfMatches）。
 * 为什么不在事件到达时就领？一次 F12 可能触发多个连续的
 * selection 事件（跳转中间态），防抖期间事件会被新事件覆盖；
 * 提前消费会把意图浪费在中间态上，导致最终落点对不上号。
 */
interface PendingCapture {
  toUri: string;
  toLine: number;
  toColumn: number;
  symbolName: string;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandWatcher {
  /**
   * selection 事件监听器的释放句柄。
   * Disposable 是 VSCode 的"可释放资源"接口：.dispose() 即取消监听。
   */
  private disposable: vscode.Disposable | null = null;

  /** 防抖中的暂存跳转；没有未确认的跳转时为 null。 */
  private pending: PendingCapture | null = null;

  /**
   * @param tree         要写入的导航树。
   * @param interceptor  意图来源：没有它就无法区分 F12 和 Find，
   *                     所以是必选参数（不允许传 null 再"退化成全记"，
   *                     那会把刚修好的污染问题悄悄带回来）。
   */
  constructor(
    private tree: NavTree,
    private interceptor: DefinitionInterceptor,
  ) {}

  /**
   * 开始监听 selection 事件。
   *
   * 无参数：确认器行为不依赖任何用户设置，所以不需要 config。
   * 设置变化时 extension.ts 只更新 tree.maxDepth，不需要重启本监听器。
   */
  activate(): void {
    this.disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
      // ── 第 1 关：扩展自己的导航（后退/前进/树点击）──
      // navigateToNode 跳转前会立起 isInternalNav 旗子（200ms 后自动倒下），
      // 这里看到旗子就放行，避免"自己记自己"造成无限长大的树。
      if (isInternalNav) {
        return;
      }

      // ── 第 2 关：只看命令触发的光标移动 ──
      // Keyboard = 打字/方向键，Mouse = 鼠标点选，都不是跳转，直接忽略。
      // kind 可能是 undefined（某些程序化 selection 变化），
      // undefined !== Command，所以一个判断就够了，不用先判空。
      if (event.kind !== vscode.TextEditorSelectionChangeKind.Command) {
        return;
      }

      // ── 读跳转目标位置 ──
      // 用 event.textEditor 而非 vscode.window.activeTextEditor：
      // 跨文件跳转时，selection 事件可能在 activeTextEditor 切换前触发，
      // 此时 activeTextEditor 仍指向旧编辑器，会读到错误的行列。
      // 行列 +1：VSCode 是 0-based（第一行是 0），我们存 1-based（第一行是 1）。
      const editor = event.textEditor;
      const uri = editor.document.uri.toString();
      const line = editor.selection.active.line + 1;
      const column = editor.selection.active.character + 1;

      // 跳转目标处的单词（函数名/变量名），记节点时当符号名用。
      // getWordRangeAtPosition 找不到单词时返回 undefined → 符号名记空字符串，
      // 后面 getNodeContext 会用 DocumentSymbol 补全，补不上就显示 '(symbol)'。
      const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
      const word = wordRange ? editor.document.getText(wordRange) : '';

      // ── 第 3 关：120ms 防抖 ──
      // 一次跳转可能触发多个连续事件（先落中间态再落稳），
      // 每次新事件都推倒重来，只确认最后一次停稳的位置。
      if (this.pending) {
        clearTimeout(this.pending.timer);
      }

      const timer = setTimeout(() => {
        this.finalizeCapture(uri, line, column, word);
      }, CURSOR_STABILIZE_DELAY_MS);

      this.pending = { toUri: uri, toLine: line, toColumn: column, symbolName: word, timer };
    });
  }

  /**
   * 停止监听并丢弃未确认的暂存跳转。
   *
   * 扩展停用时由 extension.ts 的 deactivate() 调用。
   */
  deactivate(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.disposable?.dispose();
    this.disposable = null;
  }

  /**
   * 防抖结束后的最终确认：稳定 + 是定义跳转 → 记入导航树。
   *
   * 两道关：
   *   1. 稳定性：暂存时的位置和现在的实际光标一致，才说明停稳了。
   *      不一致说明这 120ms 里光标又动了（比如用户手快又按了别的），
   *      那么新事件会重新走防抖，这里直接放弃旧的。
   *   2. 意图命中：拿落点问拦截器。有意图 = F12 全家桶 → 记；
   *      无意图 = Outline / Find / 搜索点击 → 丢弃并打日志。
   *      日志特意保留：方便新手在"输出"面板亲眼看到过滤在工作。
   */
  private async finalizeCapture(toUri: string, toLine: number, toColumn: number, symbolName: string): Promise<void> {
    // 先清空 pending，让下一次 selection 事件视为新跳转的起点，
    // 而不是"上一次还没处理完"。顺序不能反：后面的 await 会让出线程，
    // 不先清，期间进来的新事件会以为旧跳转还在防抖中。
    this.pending = null;

    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      return;
    }

    const position = editor.selection.active;
    const currentUri = editor.document.uri.toString();
    const currentLine = position.line + 1;
    const currentColumn = position.character + 1;

    // 稳定性检查：三者都对上才算停稳。
    if (currentUri !== toUri || currentLine !== toLine || currentColumn !== toColumn) {
      return;
    }

    // 意图检查：落点必须命中某次查定义的目标。
    // consume 是"一次性领取"：命中后意图被删掉，
    // 同一次跳转的后续事件不会重复记（见拦截器的注释）。
    const intent = this.interceptor.consumeIntentIfMatches(toUri, toLine);
    if (!intent) {
      console.log(`[Backtrace] ignore non-definition nav → ${toUri.split('/').pop()}:${toLine}`);
      return;
    }

    // 异步获取所在函数/类上下文（DocumentSymbolProvider），丰富节点显示。
    const ctx = await getNodeContext(toUri, toLine, toColumn, symbolName);
    const fileName = toUri.split('/').pop() || toUri;
    console.log(`[Backtrace] Nav → ${ctx.contextName || ctx.symbolName}  @ ${fileName}:${toLine} (via ${intent.kind})`);
    // 调用点用意图里的精确位置：intent.caller 就是按 F12 时光标所在处。
    this.tree.addJump(toUri, toLine, toColumn, ctx.symbolName, ctx.contextName, intent.caller);
    vscode.commands.executeCommand('backtrace._treeChanged');
  }
}
