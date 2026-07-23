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
 *
 * callerPosition 捕获策略：
 *   callerPosition 的语义是"调用点"——即被点击/光标所在的符号引用位置，
 *   而不是"跳转前光标碰巧在哪"。
 *
 *   - F12（键盘触发）：光标已经在符号上，lastKnownPosition 就是调用点 ✓
 *   - Ctrl+Click（鼠标触发）：VSCode 先触发 kind=Mouse 事件把光标移到
 *     被点击的符号，再触发 kind=Command 跳到定义。Mouse 事件的位置就是
 *     调用点。我们记录最近一次 Mouse 事件的位置，Command 事件优先使用它。
 *     如果 Mouse 事件未被捕获（某些 VSCode 版本/配置），则兜底使用
 *     父节点的记录位置。
 */

import * as vscode from 'vscode';
import { NavTree, CallerPosition } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';
import { getNodeContext } from './symbol-utils';
import { isInternalNav } from './commands/navigate';

/** Mouse 事件与 Command 事件之间的最大间隔（ms），超过则不认为是同一次 Ctrl+Click */
const MOUSE_COMMAND_WINDOW_MS = 300;

/** 暂存的跳转信息（等待防抖确认） */
interface PendingCapture {
  toUri: string;
  toLine: number;
  toColumn: number;
  symbolName: string;
  /** 调用点位置（被点击/光标所在的符号引用），用于 callerPosition 字段 */
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
   * F12 场景：光标已在符号上 → lastKnownPosition 就是调用点。
   * Ctrl+Click 场景：可能被 Mouse 事件更新为点击位置（也是调用点），
   * 也可能未被更新（取决于 VSCode 是否触发 Mouse selection 事件）。
   */
  private lastKnownPosition: CallerPosition | null = null;
  /**
   * 最近一次 Mouse 类型 selection 事件的位置和时间。
   *
   * Ctrl+Click 时 VSCode 会先触发 kind=Mouse 把光标移到被点击的符号，
   * 这个位置就是调用点。Command 事件触发时检查此字段：
   * 如果时间窗口内有过 Mouse 事件，说明是 Ctrl+Click，优先使用 Mouse 位置。
   */
  private lastMousePosition: CallerPosition | null = null;
  private lastMouseAt: number = 0;

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
      const kind = event.kind;

      const currentPos: CallerPosition = { uri, line, column };

      // 更新 lastKnownPosition（所有事件都更新）
      this.lastKnownPosition = currentPos;

      // 记录 Mouse 事件的位置和时间（用于 Ctrl+Click 检测）
      if (kind === vscode.TextEditorSelectionChangeKind.Mouse) {
        this.lastMousePosition = currentPos;
        this.lastMouseAt = Date.now();
      }

      // ── 判断是否来自扩展自身的导航 ──
      if (isInternalNav || Date.now() - this.internalNavAt < 300) {
        this.internalNavAt = 0;
        return;
      }

      if (kind === undefined) return;
      if (kind !== vscode.TextEditorSelectionChangeKind.Command) return;

      // ── 确定 callerPosition（调用点） ──
      // F12/Ctrl+Click 可能触发多个连续的 Command 类型 selection 事件。
      // 如果已有 pending capture，复用第一次捕获的 callerPosition。
      let effectiveCaller: CallerPosition | null;
      if (this.pending) {
        effectiveCaller = this.pending.callerPosition;
      } else {
        effectiveCaller = this.resolveCallerPosition();
      }

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

  /**
   * 测试专用：手动设置内部状态，以便单元测试 resolveCallerPosition。
   */
  _setTestState(opts: {
    lastKnownPosition?: CallerPosition | null;
    lastMousePosition?: CallerPosition | null;
    lastMouseAt?: number;
  }): void {
    if (opts.lastKnownPosition !== undefined) this.lastKnownPosition = opts.lastKnownPosition;
    if (opts.lastMousePosition !== undefined) this.lastMousePosition = opts.lastMousePosition;
    if (opts.lastMouseAt !== undefined) this.lastMouseAt = opts.lastMouseAt;
  }

  /**
   * 确定调用点位置（callerPosition）。
   *
   * 策略：
   *   1. 如果最近 MOUSE_COMMAND_WINDOW_MS 内有 Mouse 事件 → Ctrl+Click，
   *      使用 Mouse 事件的位置（被点击的符号 = 调用点）。
   *   2. 否则 → F12/键盘触发，光标已在符号上，
   *      使用 lastKnownPosition（跳转前的光标位置 = 调用点）。
   *   3. 兜底：使用父节点的记录位置。
   */
  resolveCallerPosition(): CallerPosition | null {
    const parent = this.tree.currentNode;

    // Ctrl+Click 检测：最近有 Mouse 事件
    if (this.lastMousePosition && Date.now() - this.lastMouseAt < MOUSE_COMMAND_WINDOW_MS) {
      const mousePos = this.lastMousePosition;
      // 消费掉，避免影响后续事件
      this.lastMousePosition = null;
      this.lastMouseAt = 0;
      return mousePos;
    }

    // F12/键盘触发：lastKnownPosition 就是调用点
    if (this.lastKnownPosition) {
      return this.lastKnownPosition;
    }

    // 兜底：父节点位置
    if (parent) {
      return { uri: parent.uri, line: parent.line, column: parent.column };
    }
    return null;
  }

  /** 120ms 防抖后确认跳转 */
  private async finalizeCapture(
    toUri: string,
    toLine: number,
    toColumn: number,
    symbolName: string,
    callerPosition: CallerPosition | null,
  ): Promise<void> {
    // 先清空 pending，让下一次 selection 事件视为新命令的起点
    this.pending = null;

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
