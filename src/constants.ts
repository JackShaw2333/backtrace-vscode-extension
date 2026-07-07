/** All preset command IDs that can be tracked */
export const PRESET_COMMANDS = [
    'editor.action.revealDefinition',
    'editor.action.revealDeclaration',
    'editor.action.goToTypeDefinition',
    'editor.action.goToImplementation',
    'editor.action.goToReferences',
    'editor.action.peekDefinition',
    'editor.action.peekImplementation',
    'editor.action.peekReferences',
] as const;

/** Commands enabled by default */
export const DEFAULT_TRACKED_COMMANDS: readonly string[] = [
    'editor.action.revealDefinition',
];

export const CURSOR_STABILIZE_DELAY_MS = 120;

/** Namespace for all backtrace config keys */
export const CONFIG_NAMESPACE = 'backtrace';

/** Key used in context.globalState for tree persistence */
export const PERSISTENCE_KEY = 'backtrace.navTree';

/** Colors assigned per file path (cycled) */
export const FILE_COLORS = [
    '#c586c0', // purple
    '#9cdcfe', // light blue
    '#dcdcaa', // yellow
    '#73c991', // light green
    '#f88070', // light red
    '#ce9178', // orange
    '#cca700', // gold
];
