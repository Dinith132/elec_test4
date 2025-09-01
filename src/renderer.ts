// renderer.ts
const WS_URL = "ws://localhost:8000/ws";

const statusEl = document.getElementById("status") as HTMLDivElement;
const commandInput = document.getElementById("commandInput") as HTMLInputElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const terminalEl = document.getElementById("terminal") as HTMLDivElement;
const planListEl = document.getElementById("plan-list") as HTMLUListElement;

// Track pending executions
const pendingExecutions = new Map<string | null, HTMLLIElement>();

function appendLine(kind: "AGENT" | "USER" | "SYSTEM" | "EXEC" | "ERROR" | "SUMMARY", text: string, codeBlock?: string) {
  // Skip the prompt marker in output
  if (text.includes('PROMPT_#END#')) return;

  const line = document.createElement("div");
  line.className = "line";
  const time = new Date().toLocaleTimeString();
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `[${time}] `;
  line.appendChild(meta);

  const tag = document.createElement("span");
  tag.textContent = `[${kind}] `;
  tag.className = kind === "AGENT" ? "agent" : (kind === "USER" ? "user" : (kind === "EXEC" ? "exec" : (kind === "ERROR" ? "error" : "")));
  line.appendChild(tag);

  const content = document.createElement("span");
  content.textContent = text;
  line.appendChild(content);

  if (codeBlock) {
    const code = document.createElement("pre");
    code.className = "code";
    code.textContent = codeBlock;
    line.appendChild(code);
  }

  terminalEl.appendChild(line);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

// Safe JSON parse
function tryParseJSON(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

// Locate runCommand in window
function getRunCommandFn(): ((cmd: string) => Promise<string>) | null {
  const w = window as any;
  if (w.terminal && typeof w.terminal.runCommand === "function") return w.terminal.runCommand.bind(w.terminal);
  if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.runCommand === "function") return w.appAPI.terminal.runCommand.bind(w.appAPI.terminal);
  if (typeof w.runCommand === "function") return w.runCommand.bind(w);
  return null;
}

const runLocalCommand = async (cmd: string): Promise<string> => {
  const fn = getRunCommandFn();
  if (!fn) throw new Error("Local runCommand API not found in preload (window.terminal or window.appAPI.terminal).");
  return await fn(cmd);
};

// WebSocket connect
let socket: WebSocket | null = null;

function connectWs(url = WS_URL) {
  socket = new WebSocket(url);
  statusEl.textContent = `Connecting to ${url}...`;

  socket.onopen = () => {
    statusEl.textContent = `Connected to agent at ${url}`;
    appendLine("SYSTEM", `WebSocket connected to ${url}`);
  };

  socket.onmessage = async (ev: MessageEvent) => {
    const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
    const msg = tryParseJSON(raw);

    if (!msg) {
      appendLine("AGENT", raw);
      return;
    }

    if (msg.final_report) {
      appendLine("SUMMARY", "Final report received:");
      appendLine("SUMMARY", JSON.stringify(msg.final_report, null, 2));
      return;
    }

    if (msg.type) {
      const t = (msg.type || "").toString();
      const topic = msg.topic ? ` (${msg.topic})` : "";
      const messageText = msg.message ?? (msg.msg ?? "");
      appendLine("AGENT", `${t}${topic}: ${String(messageText)}`);

      if (t === "EXECUTE_CODE_REQUEST" || msg.type === "EXECUTE_CODE_REQUEST") {
        const code = msg.code ?? "";
        const instructions = msg.instructions ?? "";
        appendLine("AGENT", `Agent requests execution:${topic}`, code || undefined);
        if (instructions) appendLine("AGENT", `Instructions: ${instructions}`);

        // Add to plan list
        const requestId = msg.request_id ?? null;
        const execId = requestId !== null ? requestId.toString() : `exec-${Date.now()}`; // String key
        const li = document.createElement("li");
        li.textContent = code ? `${code}` : (instructions ? `${instructions}` : "Unknown execution");
        li.className = "pending";
        li.dataset.execId = execId;
        planListEl.appendChild(li);
        planListEl.scrollTop = planListEl.scrollHeight;
        pendingExecutions.set(execId, li);

        appendLine("SYSTEM", `Executing requested code locally: ${code}`);
        try {
          const out = await runLocalCommand(code);
          const resultMsg = {
            type: "EXECUTE_CODE_RESULT",
            code,
            output: out.replace('PROMPT_#END#', '').trim(),
            success: !out.includes('[ERROR: Command timed out'),
            request_id: msg.request_id ?? null
          };
          socket?.send(JSON.stringify(resultMsg));
          appendLine("SYSTEM", `Sent EXECUTE_CODE_RESULT (success) back to agent.`);
          // Mark as done
          const execIdForSuccess = resultMsg.request_id !== null ? resultMsg.request_id.toString() : `exec-${Date.now()}`;
          const liSuccess = pendingExecutions.get(execIdForSuccess);
          if (liSuccess) {
            liSuccess.className = "done";
            liSuccess.textContent = `✔ ${liSuccess.textContent}`;
            pendingExecutions.delete(execIdForSuccess);
          }
        } catch (err) {
          const errStr = err instanceof Error ? `${err.message}` : String(err);
          appendLine("ERROR", `Execution failed for: ${code}`);
          appendLine("ERROR", errStr);
          const resultMsg = {
            type: "EXECUTE_CODE_RESULT",
            code,
            output: errStr,
            success: false,
            request_id: msg.request_id ?? null
          };
          try {
            socket?.send(JSON.stringify(resultMsg));
            appendLine("SYSTEM", `Sent EXECUTE_CODE_RESULT (failure) back to agent.`);
            // Mark as failed
            const execIdForFailure = resultMsg.request_id !== null ? resultMsg.request_id.toString() : `exec-${Date.now()}`;
            const liFailure = pendingExecutions.get(execIdForFailure);
            if (liFailure) {
              liFailure.className = "failed";
              liFailure.textContent = `✖ ${liFailure.textContent}`;
              pendingExecutions.delete(execIdForFailure);
            }
          } catch (sendErr) {
            appendLine("ERROR", `Failed to send execution result back: ${String(sendErr)}`);
          }
        }
      }
      return;
    }

    appendLine("AGENT", JSON.stringify(msg, null, 2));
  };

  socket.onerror = (e) => {
    appendLine("ERROR", `WebSocket error: ${String(e)}`);
    statusEl.textContent = "WebSocket error (check server)";
  };

  socket.onclose = (ev) => {
    appendLine("SYSTEM", `WebSocket closed: code=${ev.code} reason=${ev.reason || "none"}`);
    statusEl.textContent = "WebSocket disconnected";
  };
}

// UI actions
sendBtn.addEventListener("click", () => {
  const text = commandInput.value.trim();
  if (!text) return;
  try {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      appendLine("ERROR", "WebSocket is not connected. Please wait or check server.");
      return;
    }
    socket.send(text);
    appendLine("USER", text);
    commandInput.value = "";
  } catch (err) {
    appendLine("ERROR", `Failed to send: ${String(err)}`);
  }
});

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

clearBtn.addEventListener("click", () => {
  terminalEl.innerHTML = "";
  planListEl.innerHTML = "";
  pendingExecutions.clear();
  appendLine("SYSTEM", "Cleared terminal and plan.");
});

// Set up stream output listener
const w = window as any;
if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.onStreamOutput === "function") {
  w.appAPI.terminal.onStreamOutput((data: { text: string; isError: boolean }) => {
    appendLine(data.isError ? "ERROR" : "EXEC", data.text);
  });
}

// Start
connectWs(WS_URL);