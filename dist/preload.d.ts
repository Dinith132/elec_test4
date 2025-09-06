interface TerminalAPI {
    runCommand: (cmd: string) => Promise<string>;
    onStreamOutput: (callback: (data: {
        text: string;
        isError: boolean;
    }) => void) => void;
}
interface VersionsAPI {
    chrome: () => string;
    node: () => string;
    electron: () => string;
    ping: () => Promise<string>;
}
interface WindowControlAPI {
    (action: "minimize" | "maximize" | "close"): void;
}
interface AsniAPI {
    ansiToHtml: (ansiText: string) => Promise<string>;
}
interface AppAPI {
    versions: VersionsAPI;
    terminal: TerminalAPI;
    windowControl: WindowControlAPI;
    asni: AsniAPI;
}
declare global {
    interface Window {
        appAPI: AppAPI;
    }
}
export {};
//# sourceMappingURL=preload.d.ts.map