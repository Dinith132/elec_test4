"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// preload.ts
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld("appAPI", {
    terminal: {
        runCommand: (cmd) => electron_1.ipcRenderer.invoke('run-command', cmd),
        onStreamOutput: (callback) => {
            electron_1.ipcRenderer.on('stream-output', (event, data) => callback(data));
        }
    },
});
//# sourceMappingURL=preload.js.map