/**
 * 命令拦截器。
 *
 * 核心逻辑：监听 vscode.commands.onDidExecuteCommand，
 * 如果是白名单中的导航命令（F12/Ctrl+Click 等），记录跳转。
 *
 * 为什么需要"暂存"（PendingCapture）？
 * onDidExecuteCommand 触发时光标还没移动，
 * 需要等 120ms 让光标稳定到目标位置后再记录。
 */

import * as vscode from 'vscode';
import { NavTree } from './nav-tree';
import { BacktraceConfig } from './config';
import { CURSOR_STABILIZE_DELAY_MS } from './constants';

/** 暂存待确认的跳转信息。等待 120ms 光标稳定后再确认 */
interface PendingCapture {
    fromUri: string;        // 跳转前的文件 URI
    fromLine: number;       // 跳转前的行号
    fromColumn: number;     // 跳转前的列号
    symbolName: string;     // 跳转前的符号名
    timer: NodeJS.Timeout;  // 计时器句柄
}

/**
 * CommandWatcher 类。
 * constructor 的 private tree 是 TypeScript 快捷写法，
 * 会自动创建 this.tree 属性。
 */
export class CommandWatcher {
    private disposable: vscode.Disposable | null = null;
    private pending: PendingCapture | null = null;
    private config!: BacktraceConfig;

    constructor(private tree: NavTree) {}

    /** 开始监听命令。commandSet 用 Set 比数组快（.has() 比 .includes() 快很多） */
    activate(config: BacktraceConfig, context: vscode.ExtensionContext): void {
        this.config = config;
        const commandSet = new Set(config.trackedCommands);

        // onDidExecuteCommand：用户每次执行任何命令时触发
        // 注意：这是"提议中的 API"，需要在 package.json 中声明 enabledApiProposals
        this.disposable = vscode.commands.onDidExecuteCommand((event) => {
            if (!commandSet.has(event.command)) return; // 不在白名单中 → 忽略

            const editor = vscode.window.activeTextEditor;
            if (!editor) return;

            // 记录跳转前位置
            const position = editor.selection.active;
            const document = editor.document;
            const wordRange = document.getWordRangeAtPosition(position);
            const word = wordRange ? document.getText(wordRange) : '';

            const uri = document.uri.toString();
            const line = position.line + 1;    // VSCode 从 0 开始，我们从 1 开始
            const column = position.character + 1;

            // 取消上一个待确认的跳转（120ms 内连续命令只记最后一次）
            if (this.pending) {
                clearTimeout(this.pending.timer);
            }

            // 设置 120ms 延迟后确认跳转
            const timer = setTimeout(() => {
                this.finalizeCapture(uri, line, column, word);
            }, CURSOR_STABILIZE_DELAY_MS);

            this.pending = { fromUri: uri, fromLine: line, fromColumn: column, symbolName: word, timer };
        });

        if (this.disposable) {
            context.subscriptions.push(this.disposable);
        }
    }

    /** 停止监听，取消待确认跳转，清理事件订阅 */
    deactivate(): void {
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending = null;
        }
        this.disposable?.dispose(); // ?. 可选链：非 null 时才调用
        this.disposable = null;
    }

    /** 120ms 后确认跳转：检查光标是否真的移动了 */
    private finalizeCapture(fromUri: string, fromLine: number, fromColumn: number, symbolName: string): void {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const position = editor.selection.active;
        const toUri = editor.document.uri.toString();
        const toLine = position.line + 1;
        const toColumn = position.character + 1;

        // 位置没变 → 不是有效跳转
        if (toUri === fromUri && toLine === fromLine && toColumn === fromColumn) return;

        // 通过过滤，记录跳转
        this.tree.addJump(toUri, toLine, toColumn, symbolName);

        // 触发自定义事件通知 UI 刷新
        vscode.commands.executeCommand('backtrace._treeChanged');
    }
}
