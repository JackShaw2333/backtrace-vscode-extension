/**
 * 读取用户设置。
 *
 * VSCode 扩展通过 contributes.configuration 声明设置项后，
 * 用户可以在设置界面修改。这个文件负责把设置读出来，
 * 转成 TypeScript 友好的格式。
 *
 * vscode.workspace.getConfiguration('backtrace')
 * 会读取 .vscode/settings.json 中的 backtrace.* 项。
 */

import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, DEFAULT_TRACKED_COMMANDS } from './constants';

/** 扩展用到的所有配置项 */
export interface BacktraceConfig {
    trackedCommands: string[];   // 要追踪的命令 ID 列表（白名单）
    maxTreeDepth: number;       // 导航树的最大深度
    persistHistory: boolean;    // 是否跨会话持久化导航树
}

/** 从 VSCode 设置中读取配置。第二个参数是默认值（用户没设置时使用） */
export function readConfig(): BacktraceConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return {
        trackedCommands: cfg.get<string[]>('trackedCommands', [...DEFAULT_TRACKED_COMMANDS]),
        maxTreeDepth: cfg.get<number>('maxTreeDepth', 50),
        persistHistory: cfg.get<boolean>('persistHistory', true),
    };
}
