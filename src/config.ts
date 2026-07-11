/**
 * src/config.ts — 配置读取器
 *
 * 为什么需要这个文件？
 *
 * 我们在 package.json 的 contributes.configuration 中声明了三个设置项：
 *   backtrace.trackedCommands   → 类型 array, 默认 ["editor.action.revealDefinition"]
 *   backtrace.maxTreeDepth      → 类型 number, 默认 50
 *   backtrace.persistHistory    → 类型 boolean, 默认 true
 *
 * 用户在 VSCode 设置界面（Ctrl+,）修改这些值后，
 * VSCode 把它们存到 .vscode/settings.json 或全局 settings.json 中。
 *
 * 当我们程序运行时，需要用 TypeScript 代码把这些值读出来。
 * 读取的 API 是 vscode.workspace.getConfiguration('backtrace')。
 * 它返回一个 Configuration 对象，像一个大字典：
 *   { trackedCommands: [...], maxTreeDepth: 50, persistHistory: true }
 *
 * 这个文件就做一件事：把那个"大字典"转成我们程序里好用的 TypeScript 对象。
 */

import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, DEFAULT_TRACKED_COMMANDS } from './constants';

// ═══════════════════════════════════════════════════════════════
//  BacktraceConfig —— "配置长什么样"的蓝图
// ═══════════════════════════════════════════════════════════════
//
// 新手最容易困惑的地方：为什么需要这个 interface？
//
// 因为 VSCode 的 getConfiguration() 返回的是"不特定"的对象，
// 你只能通过字符串 key 取值：
//   cfg.get('trackedCommands')   ← 你记不记得 key 叫啥全靠记忆
//   cfg.get('maxTreeDepth')      ← 拿到的值类型也未知（可能是任何东西）
// 拼错了 key 也不会报错，运行时才发现。
//
// 有了 BacktraceConfig 这个 interface：
//   readConfig() 的返回值类型是 BacktraceConfig
//   → TypeScript 知道它有 .trackedCommands、.maxTreeDepth、.persistHistory
//   → 写代码时编辑器会自动补全，拼错了编译就报错
//
// interface 的作用就是"定义数据结构的样子"：
//   字段名 : 字段类型
// 它不包含逻辑，只描述形状。就像一张蓝图。

export interface BacktraceConfig {
    /**
     * 白名单：哪些命令触发时记录导航跳转？
     *
     * 例如默认值 ["editor.action.revealDefinition"]，
     * 这意味着只有 F12/Go to Definition 会被记录。
     * 用户可以在设置中改成 ["editor.action.goToReferences"],
     * 或者同时追踪多条命令。
     *
     * string[] 表示"字符串数组"——一个列表，每个元素是一个命令 ID。
     */
    trackedCommands: string[];

    /**
     * 导航树最大深度。
     *
     * 如果用户一天内跳了上千次，树会非常深。
     * 超出这个深度时，自动删除最旧的分支。
     * 类型是 number（数字），默认 50。
     */
    maxTreeDepth: number;

    /**
     * 是否跨会话持久化？
     *
     * true  → 导航树存入 VSCode 的 globalState，重启后还在
     * false → 重启后导航树清空
     * 类型是 boolean（布尔值），要么 true 要么 false。
     */
    persistHistory: boolean;
}

// ═══════════════════════════════════════════════════════════════
//  readConfig() —— 真正去读设置的地方
// ═══════════════════════════════════════════════════════════════
//
// arrow function 的完整语法：
//   export function readConfig(): BacktraceConfig { ... }
//   意思是"定义一个名为 readConfig 的函数，返回值是 BacktraceConfig 类型"
//
// 返回的对象字面量 { key: value } 就是
// 按照 BacktraceConfig 的蓝图，一一对应填上值。

export function readConfig(): BacktraceConfig {
    // ── step 1: 拿到"配置字典" ──
    //
    // getConfiguration('backtrace') 告诉 VSCode：
    // "把 settings.json 里所有以 backtrace. 开头的项给我"
    // 返回的对象 cfg 就像：
    //   { trackedCommands: [...], maxTreeDepth: 50, persistHistory: true }
    // 但还不是我们定义的 BacktraceConfig 类型，需要手动取值。
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);

    // ── step 2: 逐个取值 ──
    // ── step 3: 组装成 BacktraceConfig 对象并返回 ──
    return {
        // cfg.get('trackedCommands') 读的是 backtrace.trackedCommands
        //
        // <string[]> 是泛型参数，告诉 TypeScript：
        // "这个 get 调用返回的是一个字符串数组"
        // 如果不写，TypeScript 不知道返回类型，会推测为 any（失去类型保护）。
        //
        // 第二个参数 ['editor.action.revealDefinition'] 是"默认值"：
        //   如果用户从来没设置过这个选项 → 返回这个默认值
        //   如果用户设置过 → 返回用户设置的值
        //
        // 注意这里用了 [...DEFAULT_TRACKED_COMMANDS] 而不是直接传 DEFAULT_TRACKED_COMMANDS。
        // 为什么？因为 DEFAULT_TRACKED_COMMANDS 是 readonly（只读），
        // 而 cfg.get 需要的是一个可变数组。
        // ... 展开运算符把只读数组的内容"复制"到一个新数组中。
        // 可以理解为：把苹果从只读的篮子里拿出来，放进一个可以修改的新篮子。
        //
        // 如果不理解为什么需要 readonly，可以简单记为：
        //   TypeScript 使用 readonly 防止你意外修改常量，
        //   需要改的时候就要用 [...] 复制一份。
        trackedCommands: cfg.get<string[]>('trackedCommands', [
            ...DEFAULT_TRACKED_COMMANDS,
        ]),

        // 读 backtrace.maxTreeDepth
        // <number> 告诉 TypeScript 返回的是数字
        // 默认值 50
        maxTreeDepth: cfg.get<number>('maxTreeDepth', 50),

        // 读 backtrace.persistHistory
        // <boolean> 告诉 TypeScript 返回的是布尔值
        // 默认值 true
        persistHistory: cfg.get<boolean>('persistHistory', true),
    };
    // 最终返回的对象就像这样：
    // {
    //   trackedCommands: ['editor.action.revealDefinition'],
    //   maxTreeDepth: 50,
    //   persistHistory: true,
    // }
}

// ═══════════════════════════════════════════════════════════════
//  谁会用这个文件？
// ═══════════════════════════════════════════════════════════════
//
// 1. extension.ts（入口文件）：
//      在 activate() 中调用 readConfig()，拿到配置，
//      然后传给 NavTree(设置深度) 和 CommandWatcher(设置白名单)。
//
// 2. 其他模块：
//      如果有模块需要知道当前配置，可以 import readConfig 并调用。
//      但更常见的做法是在 extension.ts 里统一读取，然后传给需要的地方。
//
// 数据流向：
//   package.json（声明配置项）
//     → 用户修改设置（Ctrl+,）
//       → settings.json（存储）
//         → config.ts readConfig()（读取）
//           → extension.ts（分发）
//             → CommandWatcher：用 trackedCommands 过滤命令
//             → NavTree：用 maxTreeDepth 限制深度
//             → NavTree：用 persistHistory 决定是否存盘
