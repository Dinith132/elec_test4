console.log("==========Render Start===========");

// Assume you have a websocket connection
const ws = new WebSocket('ws://localhost:8000/ws'); // your websocket server

ws.onopen = () => {
  console.log('WebSocket connected');
};

ws.onmessage = (event) => {
  console.log('WebSocket message:', event.data);
};

// Show environment info using window.versions
const infoEl = document.getElementById('info');
if (infoEl) {
  infoEl.innerText = `This app is using Chrome (v${window.appAPI.versions.chrome()}), Node.js (v${window.appAPI.versions.node()}), and Electron (v${window.appAPI.versions.electron()})`;
}

// Terminal output element
const terminalEl = document.getElementById('terminal') as HTMLDivElement;

// Command input and button
const commandInput = document.getElementById('command') as HTMLInputElement;
const runBtn = document.getElementById('runBtn') as HTMLButtonElement;

// Function to run a command
const runCommand = async (cmd: string) => {
  if (!cmd) return;

  if (ws.readyState === WebSocket.OPEN) {
    ws.send(cmd); // non-blocking
  }

  try {
    // Call the preload exposed API
    const output = await window.appAPI.terminal.runCommand(cmd);
    terminalEl.textContent += `$ ${cmd}\n${output}\n`;
    terminalEl.scrollTop = terminalEl.scrollHeight;
  } catch (err) {
    terminalEl.textContent += `$ ${cmd}\n ${err}\n`;
    terminalEl.scrollTop = terminalEl.scrollHeight;
  }
};

// Run button click
runBtn.addEventListener('click', () => {
  runCommand(commandInput.value);
  commandInput.value = '';
});

// Enter key support
commandInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    runCommand(commandInput.value);
    commandInput.value = '';
  }
});

console.log("==========Render End===========");
