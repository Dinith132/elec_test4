// // First, declare the types for the custom 'versions' object
// interface Versions {
//   chrome: () => string;
//   node: () => string;
//   electron: () => string;
//   ping: () => Promise<string>;
// }

// interface TerminalAPI {
//   runCommand: (cmd: string) => Promise<string>;
// }

// // The combined API exposed by preload
// interface AppAPI {
//   versions: VersionsAPI;
//   terminal: TerminalAPI;
// }

// // Extend global Window interface
// declare global {
//   interface Window {
//     appAPI: AppAPI;
//   }
// }

declare module 'ansi-to-html';

export {};

