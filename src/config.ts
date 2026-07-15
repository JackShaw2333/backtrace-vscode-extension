/**
 * src/config.ts — 配置读取器
 *
 * 为什么需要这个文件？
 *
 * 我们在 package.json 的 contributes.configuration 中声明了三个设置项：
 *   backtrace.maxTreeDepth       → 类型 number,  默认 50
 *   backtrace.persistHistory     → 类型 boolean, 默认 true
 *   backtrace.forwardBehavior    → 类型 string,  默认 "notification"
 *
 * 用户在 VSCode 设置界面（Ctrl+,）修改这些值后，
 * VSCode 把它们存到 .vscode/settings.json 或全局 settings.json 中。
 *
 * 当我们程序运行时，需要用 TypeScript 代码把这些值读出来。
 * 读取的 API 是 vscode.workspace.getConfiguration('backtrace')。
 * 它返回一个 Configuration 对象，像一个大字典：
 *   { maxTreeDepth: 50, persistHistory: true, forwardBehavior: 'notification' }
 *
 * 这个文件就做一件事：把那个"大字典"转成我们程序里好用的 TypeScript 对象。
 */

import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, FORWARD_BEHAVIOR_KEY, DEFAULT_FORWARD_BEHAVIOR, ForwardBehavior } from './constants';

// ═══════════════════════════════════════════════════════════════
//  BacktraceConfig —— "配置长什么样"的蓝图
// ═══════════════════════════════════════════════════════════════

export interface BacktraceConfig {
  /** 导航树最大深度。超出时自动删除最旧的分支 */
  maxTreeDepth: number;

  /** 是否跨会话持久化导航树 */
  persistHistory: boolean;

  /**
   * 多分支前进时的行为模式。
   * 'notification' → 状态栏提示有多个前进位置，用户通过 UI 选择（默认）
   * 'quickpick'    → 弹出 QuickPick 列表让用户选择
   */
  forwardBehavior: ForwardBehavior;
}

// ═══════════════════════════════════════════════════════════════
//  readConfig() —— 真正去读设置的地方
// ═══════════════════════════════════════════════════════════════

export function readConfig(): BacktraceConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

  return {
    maxTreeDepth: cfg.get<number>('maxTreeDepth', 50),

    persistHistory: cfg.get<boolean>('persistHistory', true),

    forwardBehavior: cfg.get<ForwardBehavior>(
      FORWARD_BEHAVIOR_KEY,
      DEFAULT_FORWARD_BEHAVIOR,
    ),
  };
}
