// main.ts
import { app, BrowserWindow, ipcMain } from 'electron';
import { spawn } from 'child_process';
import * as path from 'node:path';

// This function creates the main browser window.
const createWindow = (): void => {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 800,
    height: 1000,
    transparent: true, // Enable transparency for futuristic glass effect
    backgroundColor: '#00000000', // Fully transparent base color
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const userShells: Record<number, any> = {};

  ipcMain.handle('run-command', async (event, cmd: string) => {
    const senderId = event.sender.id;

    if (!userShells[senderId]) {
      userShells[senderId] = spawn('/bin/bash', [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.env.HOME,
        env: { ...process.env, PS1: 'PROMPT_#END#' }, // Custom prompt for detection
      });
    }

    const shell = userShells[senderId];
    let finalCmd = cmd.trim();
    if (finalCmd.startsWith("sudo ")) {
      finalCmd = "pkexec " + finalCmd.slice(5); // strip "sudo " prefix
    }

    return new Promise<string>((resolve) => {
      let output = '';
      let error = '';
      let maxTimeout: NodeJS.Timeout | null = null;
      let buffer = '';

      const onStdout = (data: Buffer) => {
        const dataStr = data.toString();
        buffer += dataStr;
        output += dataStr;
        event.sender.send('stream-output', { text: dataStr, isError: false });

        // Check for prompt to detect command completion
        if (buffer.includes('PROMPT_#END#')) {
          cleanup();
          resolve((output + error).trim());
        }
      };

      const onStderr = (data: Buffer) => {
        const dataStr = data.toString();
        buffer += dataStr;
        error += dataStr;
        event.sender.send('stream-output', { text: dataStr, isError: true });

        // Check for prompt in stderr too (some commands write prompts here)
        if (buffer.includes('PROMPT_#END#')) {
          cleanup();
          resolve((output + error).trim());
        }
      };

      const cleanup = () => {
        shell.stdout.off('data', onStdout);
        shell.stderr.off('data', onStderr);
        if (maxTimeout) clearTimeout(maxTimeout);
        buffer = ''; // Reset buffer for next command
      };

      // Fallback: max 5 minutes to prevent hanging
      maxTimeout = setTimeout(() => {
        cleanup();
        event.sender.send('stream-output', { text: 'Command timed out after 5 minutes.', isError: true });
        resolve((output + error + '\n[ERROR: Command timed out after 5 minutes.]').trim());
      }, 5 * 60 * 1000); // 5 minutes

      shell.stdout.on('data', onStdout);
      shell.stderr.on('data', onStderr);

      // Write command and ensure prompt is triggered
      shell.stdin.write(`${finalCmd}\necho PROMPT_#END#\n`);
    });
  });

  // Load the index.html file into the window.
  win.loadFile('index.html');

  // Clean up shell on window close
  win.on('closed', () => {
    const senderId = win.webContents.id;
    if (userShells[senderId]) {
      userShells[senderId].kill();
      delete userShells[senderId];
    }
  });
};

// This method is called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  // On macOS, re-create a window when the dock icon is clicked
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit the app when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});