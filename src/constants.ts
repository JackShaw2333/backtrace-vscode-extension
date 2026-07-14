/**
 * 常量和默认值。
 *
 * 为什么要把常量集中在一个文件里？
 *   1. 避免"魔术数字/魔术字符串"散落在代码各处
 *   2. 以后要改默认值时只需要改一个地方
 *   3. 新人可以快速了解整个扩展有哪些可调节的参数
 *
 * export const 的含义：
 *   export = 其他文件可以 import 使用
 *   const = 这个值不能被重新赋值（对象内容仍然可变）
 *
 * "as const" 的作用：
 *   让 TypeScript 推断出"字面量类型"而非"通用字符串类型"。
 *   例如：PRESET_COMMANDS[0] 的类型是字符串字面量 'editor.action.revealDefinition'
 *   而不是普通的 string。这样类型更精确。
 */

/** 所有预置的可追踪 VSCode 命令 ID */
export const PRESET_COMMANDS = [
  'editor.action.revealDefinition', // F12 / Ctrl+Click：转到定义
  'editor.action.revealDeclaration', // 转到声明
  'editor.action.goToTypeDefinition', // 转到类型定义
  'editor.action.goToImplementation', // 转到实现
  'editor.action.goToReferences', // 转到引用
  'editor.action.peekDefinition', // 预览定义（不跳转，弹出浮窗）
  'editor.action.peekImplementation', // 预览实现
  'editor.action.peekReferences', // 预览引用
] as const;

/** 默认启用的命令（刚安装时只追踪"转到定义"，最常用的导航操作） */
export const DEFAULT_TRACKED_COMMANDS: readonly string[] = ['editor.action.revealDefinition'];

/**
 * 光标稳定等待时间（毫秒 = 0.12 秒）。
 * 为什么需要这个延迟？
 *   onDidExecuteCommand 触发时，光标还在"跳转前"的位置。
 *   命令执行后光标才会移动到"跳转后"的位置。
 *   所以需要等一小段时间让光标稳定，再获取目标位置。
 */
export const CURSOR_STABILIZE_DELAY_MS = 120;

/** VSCode 设置项的名字空间前缀。所有 backtrace.* 设置都在这个命名空间下 */
export const CONFIG_NAMESPACE = 'backtrace';

/** 前进行为设置键名。对应 package.json 中的 backtrace.forwardBehavior */
export const FORWARD_BEHAVIOR_KEY = 'forwardBehavior';

/** 前进行为默认值：状态栏通知（不弹 QuickPick） */
export const DEFAULT_FORWARD_BEHAVIOR: 'notification' = 'notification';

/** 前进行为可选值 */
export type ForwardBehavior = 'notification' | 'quickpick';

/** 在 VSCode 的 globalState（持久化存储）中保存导航树的键名 */
export const PERSISTENCE_KEY = 'backtrace.navTree';

/**
 * 文件颜色调色板。
 * 不同文件用不同颜色标记，方便在堆栈面板中快速区分文件。
 * 颜色按顺序循环分配给遇到的每个新文件。
 * 颜色选择依据：在 VSCode 的浅色和深色主题中都能看清楚。
 */
export const FILE_COLORS = [
  '#c586c0', // 紫色
  '#9cdcfe', // 浅蓝
  '#dcdcaa', // 黄色
  '#73c991', // 浅绿
  '#f88070', // 浅红
  '#ce9178', // 橙色
  '#cca700', // 金色
];
