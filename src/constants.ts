/**
 * 常量和默认值。
 *
 * 所有"魔术数字"和"魔术字符串"集中在这里，
 * 其他地方引用这些常量而非直接写值，方便日后修改。
 */

/** 所有预置的可追踪命令 ID。as const 让类型更精确 */
export const PRESET_COMMANDS = [
    'editor.action.revealDefinition',      // F12 / Ctrl+Click：转到定义
    'editor.action.revealDeclaration',      // 转到声明
    'editor.action.goToTypeDefinition',     // 转到类型定义
    'editor.action.goToImplementation',     // 转到实现
    'editor.action.goToReferences',         // 转到引用
    'editor.action.peekDefinition',         // 预览定义
    'editor.action.peekImplementation',     // 预览实现
    'editor.action.peekReferences',         // 预览引用
] as const;

/** 默认启用的命令（仅"转到定义"，用户可在设置中自行添加） */
export const DEFAULT_TRACKED_COMMANDS: readonly string[] = [
    'editor.action.revealDefinition',
];

/** 光标稳定等待时间（毫秒）。命令执行后等 120ms 让光标到位再记录 */
export const CURSOR_STABILIZE_DELAY_MS = 120;

/** VSCode 设置项的名字空间前缀 */
export const CONFIG_NAMESPACE = 'backtrace';

/** 在 VSCode 的 globalState 中存储导航树的键名 */
export const PERSISTENCE_KEY = 'backtrace.navTree';

/** 文件颜色调色板。不同文件用不同颜色，方便在堆栈面板中区分 */
export const FILE_COLORS = [
    '#c586c0', // 紫色
    '#9cdcfe', // 浅蓝
    '#dcdcaa', // 黄色
    '#73c991', // 浅绿
    '#f88070', // 浅红
    '#ce9178', // 橙色
    '#cca700', // 金色
];
