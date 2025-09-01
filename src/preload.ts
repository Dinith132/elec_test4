// preload.ts
import { contextBridge, ipcRenderer } from 'electron';

interface TerminalAPI {
  runCommand: (cmd: string) => Promise<string>;
  onStreamOutput: (callback: (data: { text: string; isError: boolean }) => void) => void;
}

contextBridge.exposeInMainWorld("appAPI", {
  terminal: <TerminalAPI>{
    runCommand: (cmd: string) => ipcRenderer.invoke('run-command', cmd),
    onStreamOutput: (callback: (data: { text: string; isError: boolean }) => void) => {
      ipcRenderer.on('stream-output', (event, data) => callback(data));
    }
  },
});