// preload.ts
import { contextBridge, ipcRenderer } from "electron";

// import Convert from "ansi-to-html";



// -------- Types --------
interface TerminalAPI {
  runCommand: (cmd: string) => Promise<string>;
  onStreamOutput: (
    callback: (data: { text: string; isError: boolean }) => void
  ) => void;
  // ansiToHtml: (ansiText: string) => string;
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

interface AsniAPI{
  ansiToHtml: (ansiText: string) => Promise<string>;
}

interface AppAPI {
  versions: VersionsAPI;
  terminal: TerminalAPI;
  windowControl: WindowControlAPI;
  asni: AsniAPI;
}

// -------- Expose APIs --------
contextBridge.exposeInMainWorld("appAPI", {
  // terminal API
  terminal: {
    runCommand: (cmd: string) => ipcRenderer.invoke("run-command", cmd),
    onStreamOutput: (callback) => {
      ipcRenderer.on("stream-output", (event, data) => callback(data));
    },
    // ansiToHtml: (ansiText: string) => new Convert().toHtml(ansiText),

  },

  // versions API
  versions: {
    chrome: () => process.versions.chrome,
    node: () => process.versions.node,
    electron: () => process.versions.electron,
    ping: async () => "pong",
  },

  // window control API
  windowControl: (action: "minimize" | "maximize" | "close") => {
    ipcRenderer.send("window-control", action);
  },

  asni: {
    ansiToHtml:(ansiText:string)=>ipcRenderer.invoke("ansi-to-html",ansiText)
  }

} as AppAPI);

// Extend window typing
declare global {
  interface Window {
    appAPI: AppAPI;
  }
}
// const ansiConvert = new Convert();

export {};
