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

/**
 * 光标稳定等待时间（毫秒 = 0.12 秒）。
 *
 * 为什么需要这个延迟？
 *   onDidChangeTextEditorSelection 在光标移动后触发，
 *   但 120ms 防抖可以过滤掉中间状态的快速连续跳转，
 *   确保只记录最终稳定的导航位置。
 */
export const CURSOR_STABILIZE_DELAY_MS = 120;

/** VSCode 设置项的名字空间前缀。所有 backtrace.* 设置都在这个命名空间下 */
export const CONFIG_NAMESPACE = 'backtrace';

/** 前进行为设置键名。对应 package.json 中的 backtrace.forwardBehavior */
export const FORWARD_BEHAVIOR_KEY = 'forwardBehavior';

/** 前进行为默认值：状态栏通知（不弹 QuickPick） */
export const DEFAULT_FORWARD_BEHAVIOR = 'notification' as const;

/** 前进行为可选值 */
export type ForwardBehavior = 'notification' | 'quickpick';

/**
 * 旧版（单根）持久化键名，保留只读兼容。
 * 新版本只读取它做迁移，不再往它写入。
 */
export const PERSISTENCE_KEY = 'backtrace.navTree';

/**
 * 多根森林（v2）持久化键名。
 *
 * 为什么不覆盖旧 key？
 *   旧版本扩展读到 v2 数据后如果再次保存，会按单根格式重写并丢掉其它根
 *   （不可逆数据丢失）。换新 key 后，降级回旧版本最多“看不见”新数据，
 *   但不会破坏它；新版本读取时先读 v2，没有才回退旧 key。
 */
export const PERSISTENCE_KEY_V2 = 'backtrace.navTree.v2';

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

/**
 * 过期（stale）节点的标题颜色。
 *
 * 为什么用灰色而不是删除线？
 * TreeItem 没有原生删除线 API（strikeThrough 只存在于 git 面板的装饰），
 * 灰色在深色/浅色主题下都可读，又和文件彩色一眼区分。
 * 配合 description 的 "· stale" 后缀 + tooltip 说明，三重信号保证
 * 可读性和区分度（纯颜色对色弱用户不友好，所以文字后缀不能省）。
 */
export const STALE_COLOR = '#808080'; // 中灰：深色/浅色主题都可读
