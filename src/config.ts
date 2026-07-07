/**
 * 读取用户设置。
 *
 * VSCode 扩展可以通过 contributes.configuration 声明自己的设置项，
 * 用户可以在"设置"界面（Ctrl+,）看到并修改这些值。
 * 这个文件负责把 VSCode 的配置 API 转成 TypeScript 接口。
 *
 * getConfiguration('backtrace') 的含义：
 *   读取 .vscode/settings.json 中所有以 backtrace. 开头的项。
 *   例如 backtrace.trackedCommands、backtrace.maxTreeDepth。
 */

import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, DEFAULT_TRACKED_COMMANDS } from './constants';

/**
 * BacktraceConfig ── 扩展用到的所有配置项。
 * 为什么需要这个 interface？把 VSCode 的键值对配置转成结构化的 TypeScript 类型，
 * 编辑器可以提供自动补全和类型检查。
 */
export interface BacktraceConfig {
    /** 要追踪的命令 ID 列表（白名单）。不在列表中的命令触发跳转时不会被记录 */
    trackedCommands: string[];
    /** 导航树的最大深度。防止分支过多撑爆内存 */
    maxTreeDepth: number;
    /** 是否跨会话持久化导航树。关闭后每次重启 VSCode 导航树清空 */
    persistHistory: boolean;
}

/**
 * 从 VSCode 设置中读取配置。
 *
 * cfg.get<T>(key, defaultValue) 的泛型 <T> 告诉 TypeScript 返回值的类型。
 * 第二个参数是默认值——用户没设置时使用。
 * [...DEFAULT_TRACKED_COMMANDS] 的 "..." 是展开运算符，
 * 把只读数组的内容复制到一个新数组中。
 */
export function readConfig(): BacktraceConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return {
        trackedCommands: cfg.get<string[]>('trackedCommands', [
            ...DEFAULT_TRACKED_COMMANDS,
        ]),
        maxTreeDepth: cfg.get<number>('maxTreeDepth', 50),
        persistHistory: cfg.get<boolean>('persistHistory', true),
    };
}
