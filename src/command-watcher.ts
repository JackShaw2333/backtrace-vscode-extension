/**
 * 导航拦截器。
 *
 * 监听光标选择变化，过滤出由命令（F12/Ctrl+Click 等）触发的跳转，
 * 记录到导航树中。
 *
 * 为什么不用 onDidExecuteCommand？
 *   该 API 未被 VSCode 正式引入（既不是稳定 API 也不是任何 proposal），
 *   无法使用。替代方案是 onDidChangeTextEditorSelection 配合
 *   event.kind === Command 来识别命令触发的光标移动。
 *
 * 工作流程：
 *   1. 用户按 F12 → 光标移动 → onDidChangeTextEditorSelection 触发
 *   2. 检查 event.kind === Command → 是命令触发的
 *   3. 记录跳转后位置，等待 120ms 防抖
 *   4. 确认位置稳定后写入 NavTree
 */

import * as vscode from 'vscode';
import { NavTree, CallerPosition } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';
import { getNodeContext } from './symbol-utils';
import { isInternalNav } from './commands/navigate';

/** 暂存的跳转信息（等待防抖确认） */
interface PendingCapture {
  toUri: string;
  toLine: number;
  toColumn: number;
  symbolName: string;
  /** 跳转前光标位置（父节点的调用点），用于 callerPosition 字段 */
  callerPosition: CallerPosition | null;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandWatcher {
  private disposable: vscode.Disposable | null = null;
  private pending: PendingCapture | null = null;
  private config!: BacktraceConfig;
  /** 内部导航发生的时间戳，用于甄别选择变化是否来自扩展自身 */
  private internalNavAt: number = 0;
  /**
   * 最近一次稳定的光标位置（任意 selection 事件都会更新它）。
   *
   * 为什么需要它？
   *   当 Command 类型事件（F12/Ctrl+Click）触发时，新节点应当记录
   *   "从父节点的哪个位置跳转过来"。本字段在每次 selection 事件开头
   *   快照一次，因此 Command 事件读取到的就是跳转前的光标位置。
   *
   * 为什么所有事件都更新它？
   *   - 早返回路径（如 isInternalNav、kind !== Command）也应当更新，
   *     否则下一次 Command 事件会拿到过期的位置。
   *   - 例如用户用鼠标点了一下 B.ts:50，然后按 F12：必须把 B.ts:50
   *     作为 callerPosition 记录下来。
   */
  private lastKnownPosition: CallerPosition | null = null;

  constructor(private tree: NavTree) {}

  /**
   * 记录一次内部导航的时间戳。
   * navigateToNode 执行前会设置 isInternalNav 标志，
   * 此方法记录当前时间，供事件处理器判断。
   */
  markInternalNav(): void {
    this.internalNavAt = Date.now();
  }

  activate(config: BacktraceConfig): void {
    this.config = config;

    this.disposable = vscode.window.onDidChangeTextEditorSelection((event) => {
      // 使用 event.textEditor 而非 vscode.window.activeTextEditor：
      // 跨文件跳转时，selection 事件可能在 activeTextEditor 切换前触发，
      // 此时 activeTextEditor 仍指向旧编辑器，读到错误的行列位置。
      const editor = event.textEditor;
      const uri = editor.document.uri.toString();
      const line = editor.selection.active.line + 1;
      const column = editor.selection.active.character + 1;

      // 先快照调用者位置，再更新 lastKnownPosition。
      // 这样 Command 事件拿到的是跳转前的光标位置，
      // 而所有早返回路径（包括 isInternalNav）也都能更新 lastKnownPosition。
      const callerPosition = this.lastKnownPosition;
      this.lastKnownPosition = { uri, line, column };

      // ── 判断是否来自扩展自身的导航 ──
      // 如果 isInternalNav 标志在 300ms 内被设置过，
      // 说明本次选择变化是由 navigateToNode（树点击/堆栈点击/后退/前进）触发的，
      // 应当忽略，不记录到导航树。
      if (isInternalNav || Date.now() - this.internalNavAt < 300) {
        this.internalNavAt = 0;
        return;
      }

      if (event.kind === undefined) return;
      if (event.kind !== vscode.TextEditorSelectionChangeKind.Command) return;

      // F12/Ctrl+Click 可能触发多个连续的 Command 类型 selection 事件。
      // 第一个事件的 callerPosition（来自 lastKnownPosition）是用户真实的跳转前位置；
      // 后续事件读到的 lastKnownPosition 已被第一个事件污染为中间位置。
      // 因此：如果已有 pending capture（说明同一命令的多个事件正在防抖中），
      // 复用第一次捕获的 callerPosition。
      const effectiveCaller = this.pending ? this.pending.callerPosition : callerPosition;

      const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
      const word = wordRange ? editor.document.getText(wordRange) : '';

      if (this.pending) clearTimeout(this.pending.timer);

      const timer = setTimeout(() => {
        this.finalizeCapture(uri, line, column, word, effectiveCaller);
      }, CURSOR_STABILIZE_DELAY_MS);

      this.pending = { toUri: uri, toLine: line, toColumn: column, symbolName: word, callerPosition: effectiveCaller, timer };
    });
  }

  deactivate(): void {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
    this.disposable?.dispose();
    this.disposable = null;
  }

  /** 120ms 防抖后确认跳转 */
  private async finalizeCapture(
    toUri: string,
    toLine: number,
    toColumn: number,
    symbolName: string,
    callerPosition: CallerPosition | null,
  ): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const position = editor.selection.active;
    const currentUri = editor.document.uri.toString();
    const currentLine = position.line + 1;
    const currentColumn = position.character + 1;

    // 位置与暂存时一致 → 跳转稳定，记录
    if (currentUri === toUri && currentLine === toLine && currentColumn === toColumn) {
      // 异步获取所在函数/类上下文
      const ctx = await getNodeContext(toUri, toLine, toColumn, symbolName);
      const fileName = toUri.split('/').pop() || toUri;
      console.log(`[Backtrace] Nav → ${ctx.contextName || ctx.symbolName}  @ ${fileName}:${toLine}`);
      this.tree.addJump(toUri, toLine, toColumn, ctx.symbolName, ctx.contextName, callerPosition);
      vscode.commands.executeCommand('backtrace._treeChanged');
    }
  }
}
