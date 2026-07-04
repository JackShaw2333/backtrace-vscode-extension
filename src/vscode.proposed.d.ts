// Proposed VSCode API declarations not yet in stable @types/vscode
// https://github.com/microsoft/vscode/issues/200586
declare module 'vscode' {
    export namespace commands {
        /**
         * An event that is fired when a command is executed.
         * The event contains the command ID and arguments.
         */
        export const onDidExecuteCommand: Event<{ command: string; args?: unknown[] }>;
    }
}
