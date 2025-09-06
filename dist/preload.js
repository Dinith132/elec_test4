"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// preload.ts
const electron_1 = require("electron");
// -------- Expose APIs --------
electron_1.contextBridge.exposeInMainWorld("appAPI", {
    // terminal API
    terminal: {
        runCommand: (cmd) => electron_1.ipcRenderer.invoke("run-command", cmd),
        onStreamOutput: (callback) => {
            electron_1.ipcRenderer.on("stream-output", (event, data) => callback(data));
        },
    },
    // versions API
    versions: {
        chrome: () => process.versions.chrome,
        node: () => process.versions.node,
        electron: () => process.versions.electron,
        ping: async () => "pong",
    },
    // window control API
    windowControl: (action) => {
        electron_1.ipcRenderer.send("window-control", action);
    },
});
//# sourceMappingURL=preload.js.map