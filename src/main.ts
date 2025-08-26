import { app, BrowserWindow, ipcMain } from 'electron';
import { exec } from 'child_process';
import * as path from 'node:path';

// This function creates the main browser window.
const createWindow = (): void => {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      // The preload script is a bridge between Node.js and the renderer's web page.
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // An IPC (Inter-Process Communication) handler for a 'ping' message.
  ipcMain.handle('run-command', async (_, cmd: string) => {
    return new Promise<string>((resolve, reject) => {
      exec(cmd, (error, stdout, stderr) => {
        if (error) {
          reject(stderr || error.message);
        } else {
          resolve(stdout);
        }
      });
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
