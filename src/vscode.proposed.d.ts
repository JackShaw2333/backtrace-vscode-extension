/**
 * vscode.proposed.d.ts ── 提议中的 VSCode API 类型声明。
 *
 * 为什么需要这个文件？
 *   onDidExecuteCommand 是一个较新的 API，
 *   在当前的 @types/vscode 版本中还没有包含它的类型定义。
 *   但是 VSCode 运行时已经支持这个 API（需要通过 enabledApiProposals 开启）。
 *
 * 这叫做"类型声明扩充"（Type Augmentation / Module Augmentation）：
 *   declare module 'vscode' {
 *     告诉 TypeScript：我要给'vscode'模块补充一些类型定义。
 *     在运行时，这些类型和 vscode 原有的类型合并在一起。
 *   }
 *
 * 相关配置：
 *   package.json 中需要设置：
 *     "enabledApiProposals": ["onDidExecuteCommand"]
 *   否则 VSCode 运行时不会启用这个 API。
 */

declare module 'vscode' {
    export namespace commands {
        /**
         * 每次用户执行一个命令时触发的事件。
         * 不管命令是否成功执行，都会触发。
         *
         * @eventProperty
         * @param event.command - 命令 ID，例如 "editor.action.revealDefinition"
         * @param event.args - 传递给命令的参数（大多数情况下不需要）
         */
        export const onDidExecuteCommand: Event<{ command: string; args?: unknown[] }>;
    }
}
