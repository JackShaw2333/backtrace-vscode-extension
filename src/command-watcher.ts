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
 * callerPosition 捕获策略（核心难点）：
 *   Ctrl+Click 会依次触发两个 selection 事件：
 *     ① kind=Mouse    → 光标移到被点击的符号（可能污染 lastKnownPosition）
 *     ② kind=Command  → 光标跳到定义所在位置
 *   仅靠单个 lastKnownPosition 无法还原跳转前的真实位置。
 *   本模块保留一个**小型位置历史**（最近 4 次事件），在 Command 事件
 *   触发时反向遍历，选取最佳候选：
 *     - 与父节点同文件
 *     - 且不在跳转目标行（±2 行，过滤掉"点击同文件符号"的污染）
 *   找不到则回退到父节点的记录位置，语义上"从父节点跳转过来"。
 */

import * as vscode from 'vscode';
import { NavTree, CallerPosition } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';
import { getNodeContext } from './symbol-utils';
import { isInternalNav } from './commands/navigate';

/** 位置历史缓冲区大小 */
const POSITION_HISTORY_SIZE = 4;
/** caller 候选与目标行的最小行距（小于此值视为污染） */
const CALLER_LINE_TOLERANCE = 2;

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
   * 最近几次光标位置（所有 selection 事件都会追加，最多保留 4 条）。
   *
   * 为什么需要历史而不是单个 lastKnownPosition？
   *   Ctrl+Click 的 Mouse 事件会污染 lastKnownPosition 为"被点击的符号"，
   *   使紧随其后的 Command 事件读到错误的 caller。保留最近几次位置后，
   *   可以在 Command 事件触发时反向扫描，挑选出未被污染的真实 caller。
   */
  private positionHistory: CallerPosition[] = [];

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
      const isCommand = kind === vscode.TextEditorSelectionChangeKind.Command;

      const currentPos: CallerPosition = { uri, line, column };

      // 追加到历史缓冲区（避免与上一条重复才追加）
      const last = this.positionHistory[this.positionHistory.length - 1];
      if (!last || last.uri !== uri || last.line !== line || last.column !== column) {
        this.positionHistory.push(currentPos);
        if (this.positionHistory.length > POSITION_HISTORY_SIZE) {
          this.positionHistory.shift();
        }
      }

      // ── 判断是否来自扩展自身的导航 ──
      // 如果 isInternalNav 标志在 300ms 内被设置过，
      // 说明本次选择变化是由 navigateToNode（树点击/堆栈点击/后退/前进）触发的，
      // 应当忽略，不记录到导航树。
      if (isInternalNav || Date.now() - this.internalNavAt < 300) {
        this.internalNavAt = 0;
        return;
      }

      if (kind === undefined) return;
      if (!isCommand) return;

      // ── 从历史中挑选最佳 callerPosition ──
      // F12/Ctrl+Click 可能触发多个连续的 Command 类型 selection 事件：
      // 第一个事件的 callerPosition 来自跳转前的真实光标位置；
      // 后续事件由于 lastKnownPosition 被污染，可能读到中间位置。
      // 因此：如果已有 pending capture，复用第一次捕获的 callerPosition。
      let effectiveCaller: CallerPosition | null;
      if (this.pending) {
        effectiveCaller = this.pending.callerPosition;
      } else {
        effectiveCaller = this.pickCallerFromHistory(currentPos);
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
   * 测试专用：手动注入位置历史，以便单元测试 pickCallerFromHistory。
   * 生产代码不应调用此方法。
   */
  _setTestHistory(history: CallerPosition[]): void {
    this.positionHistory = [...history];
  }

  /**
   * 从 positionHistory 中反向挑选最佳 callerPosition。
   *
   * 选择标准：
   *   1. 必须与父节点（currentNode）同文件；
   *   2. 行号与跳转目标行距离 > CALLER_LINE_TOLERANCE（过滤掉 Ctrl+Click
   *      同文件符号产生的"中间位置"污染）；
   *   3. 反向扫描，取最近一条满足条件的。
   *
   * 找不到时回退到父节点的记录位置（语义：从父节点跳转过来）。
   *
   * @param destinationPos 跳转目标位置（Command 事件的当前光标位置）
   */
  pickCallerFromHistory(destinationPos: CallerPosition): CallerPosition | null {
    const parent = this.tree.currentNode;

    // 反向扫描：从最近一条（Command 事件前一条）开始
    for (let i = this.positionHistory.length - 1; i >= 0; i--) {
      const candidate = this.positionHistory[i];

      // 与父节点不同文件 → 跳过（跨文件跳转前的中间位置不应作为 caller）
      if (parent && candidate.uri !== parent.uri) continue;

      // 与跳转目标同文件且行距很近 → 视为污染（点击同文件符号的中间位置），跳过
      if (
        candidate.uri === destinationPos.uri
        && Math.abs(candidate.line - destinationPos.line) <= CALLER_LINE_TOLERANCE
      ) {
        continue;
      }

      return candidate;
    }

    // 历史中没有合适候选 → 回退到父节点的记录位置
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
