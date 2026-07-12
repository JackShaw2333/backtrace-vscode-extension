/**
 * 命令拦截器。
 *
 * 这个类是扩展的核心引擎：监听用户执行了什么命令，如果命中白名单，
 * 就记录一次导航跳转。
 *
 * 工作流程：
 *   1. 用户按 F12 → onDidExecuteCommand 触发
 *   2. 检查命令 ID 是否在白名单中 → 是
 *   3. 记录"跳转前"的光标位置
 *   4. 等待 120ms（让光标稳定到目标位置）
 *   5. 再次获取光标位置 → 确实变化了 → 记录跳转
 *
 * 为什么需要等 120ms？
 *   onDidExecuteCommand 触发时，光标还停留在"跳转前"的位置。
 *   命令实际执行后光标才会移动，所以需要等一会再获取目标位置。
 *   这叫"防抖"（debounce），防止在光标稳定前错误记录。
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';

/**
 * PendingCapture（"待确认"的跳转信息）。
 *
 * 为什么需要这个临时结构？
 *   命令触发 → 记录"出发位置" → 等 120ms → 再记录"到达位置"。
 *   在这 120ms 内，需要暂存"出发位置"，还要能取消（如果用户又执行了新命令）。
 */
interface PendingCapture {
  fromUri: string; // 跳转前的文件 URI
  fromLine: number; // 跳转前的行号
  fromColumn: number; // 跳转前的列号
  symbolName: string; // 跳转前光标所在的符号名
  timer: ReturnType<typeof setTimeout>; // setTimeout 返回的计时器句柄，用于取消等待
}

/**
 * CommandWatcher 类。
 *
 * constructor 参数前面的 private 是 TypeScript 的"参数属性"快捷写法：
 *   它会自动创建一个 this.tree 属性并赋值为传入的参数。
 *   等价于：
 *     private tree: NavTree;
 *     constructor(tree: NavTree) { this.tree = tree; }
 */
export class CommandWatcher {
  /**
   * disposable（一次性资源）：
   *   保存 vscode.commands.onDidExecuteCommand() 返回的注册句柄。
   *   为什么保存它？扩展停用时需要调用 .dispose() 来取消监听。
   *   为什么可能为 null？还没调用 activate() 时就是 null。
   */
  private disposable: vscode.Disposable | null = null;

  /**
   * pending（待确认的跳转）：
   *   在 120ms 等待期内暂存的临时信息。
   *   为什么需要它？
   *     - 如果 120ms 内用户又执行了一个命令，需要取消上一次的等待
   *     - 120ms 后，用这里存的"出发位置"和"到达位置"做比对
   */
  private pending: PendingCapture | null = null;

  /**
   * config（当前配置）：
   *   保存用户设置，在事件处理函数中读取。
   *   为什么要存成属性？因为 onDidExecuteCommand 的回调函数
   *   在 activate() 之外执行，需要通过 this.config 访问配置。
   *   "!" 是非空断言，告诉 TypeScript"这个属性在使用前一定会被赋值"。
   */
  private config!: BacktraceConfig;

  constructor(private tree: NavTree) {}

  /**
   * 开始监听。
   *
   * 做了四件事：
   *   1. 保存配置
   *   2. 把命令白名单转成 Set（为什么用 Set？.has() 比 .includes() 快很多）
   *   3. 注册 onDidExecuteCommand 事件监听
   *   4. 把注册句柄加入 context.subscriptions（扩展停用时自动清理）
   */
  activate(config: BacktraceConfig, context: vscode.ExtensionContext): void {
    this.config = config;

    const commandSet = new Set(config.trackedCommands);

    // onDidExecuteCommand: 注册一个监听器（如同 addEventListener）。
    // 它返回一个 Disposable 对象，赋值给 this.disposable。
    //
    // Disposable 是什么？
    //   VSCode 中 "注册一个功能"时几乎都返回 Disposable。
    //   Disposable 只有一个方法 .dispose()，调用它 = "取消注册"。
    //   类比：addEventListener 返回的 removeEventListener 函数。
    //
    // this.disposable 只赋值一次（本行）。
    // 回调不会修改 this.disposable。this.disposable 代表的是
    // "这次监听注册"本身，不是每次命令执行的结果。
    this.disposable = vscode.commands.onDidExecuteCommand((event) => this.onCommandExecuted(event, commandSet));

    if (this.disposable) {
      context.subscriptions.push(this.disposable);
    }
  }

  /**
   * 当用户执行了一个命令时触发（由 activate 中注册的回调转发过来）。
   *
   * @param event     onDidExecuteCommand 传过来的事件 { command, args }
   * @param commandSet 当前白名单的 Set 集合
   */
  private onCommandExecuted(event: { command: string; args?: unknown[] }, commandSet: Set<string>): void {
    // event.command 是字符串命令 ID，例如 "editor.action.revealDefinition"
    // 不在白名单中 → 忽略（白名单只有导航命令）
    if (!commandSet.has(event.command)) return;

    // activeTextEditor: 当前活跃编辑器。如果用户没在编辑文件则忽略
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // selection.active: 光标位置
    const position = editor.selection.active;
    const document = editor.document;

    // getWordRangeAtPosition: 获取光标所在"单词"的范围，例如 "handleClick"
    const wordRange = document.getWordRangeAtPosition(position);
    const word = wordRange ? document.getText(wordRange) : '';

    // VSCode 行列从 0 开始，我们 +1 转成 1-based（更符合直觉）
    const uri = document.uri.toString();
    const line = position.line + 1;
    const column = position.character + 1;

    // ── 防抖（debounce）：取消上一次等待 ──
    // 如果用户在 120ms 内连续执行了多个命令，只处理最后一次。
    // 例：快速按两次 F12 →
    //   第一次：pending = {...计时器A}  ← 开始了 120ms 等待
    //   第二次：进入此 if → clearTimeout(计时器A) → 下面重建 pending = {...计时器B}
    //   结果：只处理第二次，第一次作废
    if (this.pending) {
      clearTimeout(this.pending.timer);
    }

    // 设置 120ms 延迟后确认跳转
    const timer = setTimeout(() => {
      this.finalizeCapture(uri, line, column, word);
    }, CURSOR_STABILIZE_DELAY_MS);

    // 暂存"出发位置"信息
    this.pending = {
      fromUri: uri,
      fromLine: line,
      fromColumn: column,
      symbolName: word,
      timer,
    };
  }

  /**
   * 停止监听，清理资源。
   * 在扩展停用或配置变更时调用。
   */
  deactivate(): void {
    // 取消等待中的确认（如果有的话）
    if (this.pending) {
      clearTimeout(this.pending.timer); // 取消 setTimeout
      this.pending = null; // 释放引用
    }
    // "?." 是可选链：如果 disposable 是 null 就不调用 dispose()，不会报错。
    // 等价于：if (this.disposable) { this.disposable.dispose(); }
    this.disposable?.dispose();
    this.disposable = null;
  }

  /**
   * 120ms 后执行的确认函数。
   *
   * 做了三件事：
   *   1. 获取 120ms 后的光标位置（"到达位置"）
   *   2. 比对"出发位置"和"到达位置"——真的跳转了吗？
   *   3. 确实跳转了 → 写入 NavTree
   */
  private finalizeCapture(fromUri: string, fromLine: number, fromColumn: number, symbolName: string): void {
    // 再次获取当前编辑器——120ms 后用户可能已经切换到其他窗口了
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // 获取"跳转后"的光标位置
    const position = editor.selection.active;
    const toUri = editor.document.uri.toString();
    const toLine = position.line + 1;
    const toColumn = position.character + 1;

    // 位置完全没变 → 命令没有实际产生跳转。
    // 可能的原因：命令执行失败了，或者超出了 120ms 用户又取消了跳转。
    // 三个维度（文件、行、列）都一致才判定为"没动"。
    if (toUri === fromUri && toLine === fromLine && toColumn === fromColumn) return;

    // 通过以上过滤 → 这是一次有效的导航跳转，记录到导航树。
    this.tree.addJump(toUri, toLine, toColumn, symbolName);

    // executeCommand('backtrace._treeChanged') 触发内部事件，
    // 通知侧边栏树视图和底部堆栈面板刷新显示。
    vscode.commands.executeCommand('backtrace._treeChanged');
  }
}
