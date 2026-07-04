import * as vscode from 'vscode';
import { CONFIG_NAMESPACE, DEFAULT_TRACKED_COMMANDS } from './constants';

export interface BacktraceConfig {
    trackedCommands: string[];
    maxTreeDepth: number;
    persistHistory: boolean;
}

/** Read configuration from VSCode settings */
export function readConfig(): BacktraceConfig {
    const cfg = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
    return {
        trackedCommands: cfg.get<string[]>('trackedCommands', [...DEFAULT_TRACKED_COMMANDS]),
        maxTreeDepth: cfg.get<number>('maxTreeDepth', 50),
        persistHistory: cfg.get<boolean>('persistHistory', true),
    };
}
