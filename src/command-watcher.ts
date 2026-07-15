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
import { NavTree } from './nav-tree';
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
  timer: ReturnType<typeof setTimeout>;
}

export class CommandWatcher {
  private disposable: vscode.Disposable | null = null;
  private pending: PendingCapture | null = null;
  private config!: BacktraceConfig;
  /** 内部导航发生的时间戳，用于甄别选择变化是否来自扩展自身 */
  private internalNavAt: number = 0;

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

      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      const wordRange = editor.document.getWordRangeAtPosition(editor.selection.active);
      const word = wordRange ? editor.document.getText(wordRange) : '';

      const uri = editor.document.uri.toString();
      const line = editor.selection.active.line + 1;
      const column = editor.selection.active.character + 1;

      if (this.pending) clearTimeout(this.pending.timer);

      const timer = setTimeout(() => {
        this.finalizeCapture(uri, line, column, word);
      }, CURSOR_STABILIZE_DELAY_MS);

      this.pending = { toUri: uri, toLine: line, toColumn: column, symbolName: word, timer };
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
      this.tree.addJump(toUri, toLine, toColumn, ctx.symbolName, ctx.contextName);
      vscode.commands.executeCommand('backtrace._treeChanged');
    }
  }
}
