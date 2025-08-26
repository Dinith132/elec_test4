import { contextBridge, ipcRenderer } from 'electron';
import { versions } from 'process';


interface TerminalAPI {
  runCommand: (cmd: string) => Promise<string>;
}

// Expose the API to the renderer process
contextBridge.exposeInMainWorld("appAPI",{
  terminal: <TerminalAPI>{
    runCommand: (cmd: string) => ipcRenderer.invoke('run-command', cmd)
  },
});
