"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// main.ts
const electron_1 = require("electron");
const child_process_1 = require("child_process");
const path = __importStar(require("node:path"));
const ansi_to_html_1 = __importDefault(require("ansi-to-html"));
// This function creates the main browser window.
const createWindow = () => {
    // Create the browser window.
    const win = new electron_1.BrowserWindow({
        width: 800,
        height: 1000,
        frame: false,
        titleBarStyle: 'hidden',
        transparent: true, // Enable transparency for futuristic glass effect
        backgroundColor: '#00000000', // Fully transparent base color
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
        },
    });
    const userShells = {};
    electron_1.ipcMain.handle('run-command', async (event, cmd) => {
        const senderId = event.sender.id;
        if (!userShells[senderId]) {
            userShells[senderId] = (0, child_process_1.spawn)('/bin/zsh', [], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: process.env.HOME,
                env: { ...process.env, PS1: 'PROMPT_#END# ' }, // Custom prompt for detection
            });
        }
        const shell = userShells[senderId];
        let finalCmd = cmd.trim();
        if (finalCmd.startsWith("sudo ")) {
            finalCmd = "pkexec " + finalCmd.slice(5); // strip "sudo " prefix
        }
        return new Promise((resolve) => {
            let output = '';
            let error = '';
            let maxTimeout = null;
            let buffer = '';
            const onStdout = (data) => {
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
            const onStderr = (data) => {
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
                if (maxTimeout)
                    clearTimeout(maxTimeout);
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
            shell.stdin.write(`${finalCmd}\necho _CURRENT_DIR:$PWD; echo PROMPT_#END#\n`);
        });
    });
    electron_1.ipcMain.handle('ansi-to-html', async (event, ansiText) => {
        const converter = new ansi_to_html_1.default({
            fg: '#FFF', // default foreground
            bg: '#000', // default background
            newline: true, // preserve newlines
            escapeXML: true, // escape HTML chars
            stream: true, // treat as stream (important!)
            // DO NOT strip spaces
            // 'ansi-to-html' may strip leading spaces if stream=false
        });
        console.log("Converting ANSI to HTML:", JSON.stringify(ansiText));
        const html = converter.toHtml(ansiText);
        console.log("Converted ANSI to HTML:", html);
        return html;
    });
    // main.ts (add this after you create BrowserWindow)
    electron_1.ipcMain.on("window-control", (event, action) => {
        const win = electron_1.BrowserWindow.fromWebContents(event.sender);
        if (!win)
            return;
        if (action === "minimize") {
            win.minimize();
        }
        else if (action === "maximize") {
            if (win.isMaximized()) {
                win.unmaximize();
            }
            else {
                win.maximize();
            }
        }
        else if (action === "close") {
            win.close();
        }
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
electron_1.app.whenReady().then(() => {
    createWindow();
    // On macOS, re-create a window when the dock icon is clicked
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
// Quit the app when all windows are closed, except on macOS.
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
//# sourceMappingURL=main.js.map