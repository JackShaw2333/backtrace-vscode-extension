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
  timer: NodeJS.Timeout; // setTimeout 返回的计时器句柄，用于取消等待
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

    this.disposable = vscode.commands.onDidExecuteCommand((event) => {
      // event.command 是字符串，例如 "editor.action.revealDefinition"
      if (!commandSet.has(event.command)) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const position = editor.selection.active;
      const document = editor.document;

      // 获取光标所在的"单词"（符号名）
      // getWordRangeAtPosition 返回光标所在单词的范围
      const wordRange = document.getWordRangeAtPosition(position);
      const word = wordRange ? document.getText(wordRange) : '';

      // VSCode 的行列从 0 开始，但我们从 1 开始记（更符合人的直觉）
      const uri = document.uri.toString();
      const line = position.line + 1;
      const column = position.character + 1;

      // 取消上一个待确认的跳转（防抖：只记最后一次）
      if (this.pending) {
        clearTimeout(this.pending.timer);
      }

      // 设置 120ms 延迟后执行确认
      const timer = setTimeout(() => {
        this.finalizeCapture(uri, line, column, word);
      }, CURSOR_STABILIZE_DELAY_MS);

      this.pending = {
        fromUri: uri,
        fromLine: line,
        fromColumn: column,
        symbolName: word,
        timer,
      };
    });

    if (this.disposable) {
      context.subscriptions.push(this.disposable);
    }
  }

  /**
   * 停止监听，清理资源。
   * 在扩展停用或配置变更时调用。
   */
  deactivate(): void {
    // 取消待确认的跳转
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    // "?." 是可选链：如果 disposable 不是 null 才调用 dispose()
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
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const position = editor.selection.active;
    const toUri = editor.document.uri.toString();
    const toLine = position.line + 1;
    const toColumn = position.character + 1;

    // 位置完全没变 → 命令没有产生跳转（可能是误触命令或超时）
    if (toUri === fromUri && toLine === fromLine && toColumn === fromColumn) return;

    // 通过过滤 → 记录跳转
    this.tree.addJump(toUri, toLine, toColumn, symbolName);

    // 触发自定义事件，通知所有 UI 刷新
    vscode.commands.executeCommand('backtrace._treeChanged');
  }
}
