declare const WS_URL = "ws://localhost:8000/ws";
declare const statusEl: HTMLDivElement;
declare const commandInput: HTMLInputElement;
declare const sendBtn: HTMLButtonElement;
declare const clearBtn: HTMLButtonElement;
declare const terminalEl: HTMLDivElement;
declare const planListEl: HTMLUListElement;
declare const pendingExecutions: Map<string, HTMLLIElement>;
declare function appendLine(kind: string, text: string, codeBlock?: string): void;
declare function tryParseJSON(s: string): any | null;
declare function getRunCommandFn(): ((cmd: string) => Promise<string>) | null;
declare const runLocalCommand: (cmd: string) => Promise<string>;
declare let socket: WebSocket | null;
declare function connectWs(url?: string): void;
declare const w: any;
//# sourceMappingURL=renderer.d.ts.map