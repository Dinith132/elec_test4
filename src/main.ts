import { app, BrowserWindow, ipcMain } from 'electron';
// import { exec } from 'child_process';
import { spawn } from 'child_process';
import * as path from 'node:path';

// This function creates the main browser window.
const createWindow = (): void => {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 800,
    height: 1000,
    webPreferences: {
      // The preload script is a bridge between Node.js and the renderer's web page.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // An IPC (Inter-Process Communication) handler for a 'ping' message.
  // ipcMain.handle('run-command', async (_, cmd: string) => {
  //   return new Promise<string>((resolve, reject) => {
  //     // If user typed "sudo something", replace with pkexec
  //     let finalCmd = cmd.trim();
  //     if (finalCmd.startsWith("sudo ")) {
  //       finalCmd = "pkexec " + finalCmd.slice(5); // remove "sudo " prefix
  //     }

  //     exec(finalCmd, (error, stdout, stderr) => {
  //       if (error) {
  //         reject(stderr || error.message);
  //       } else {
  //         resolve(stdout || stderr || ""); // return both stdout/stderr
  //       }
  //     });
  //   });
  // });


  // let shell = spawn('bash', [], {
  //   stdio: ['pipe', 'pipe', 'pipe']
  // });


const userShells: Record<number, any> = {};


ipcMain.handle('run-command', async (event, cmd: string) => {
  const senderId = event.sender.id;

  if (!userShells[senderId]) {
    userShells[senderId] = spawn('/bin/bash', [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.env.HOME,
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
    let timeout: NodeJS.Timeout | null = null;

    const flush = () => {
      shell.stdout.off('data', onStdout);
      shell.stderr.off('data', onStderr);
      resolve((output + error).trim());
    };

    const onStdout = (data: Buffer) => {
      output += data.toString();
      resetTimer();
    };

    const onStderr = (data: Buffer) => {
      error += data.toString();
      resetTimer();
    };

    const resetTimer = () => {
      if (timeout) clearTimeout(timeout);
      // Assume command finished if no more data in 100ms
      timeout = setTimeout(flush, 10000);
    };

    shell.stdout.on('data', onStdout);
    shell.stderr.on('data', onStderr);

    shell.stdin.write(`${finalCmd}\n`);
    resetTimer();
  });
});




  // Load the index.html file into the window.
  win.loadFile('index.html');
};

// This method is called when Electron has finished initialization
// and is ready to create browser windows.
app.whenReady().then(() => {
  createWindow();

  // On macOS, it's common to re-create a window when the dock icon is
  // clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit the app when all windows are closed, except on macOS.
app.on('window-all-closed', () => {
  // On macOS, applications and their menu bar often stay active until
  // the user quits explicitly with Cmd + Q.
  if (process.platform !== 'darwin') {
    app.quit();
  }
});