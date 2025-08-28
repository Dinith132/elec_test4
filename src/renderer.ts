const WS_URL = "ws://localhost:8000/ws"; 

const statusEl = document.getElementById("status") as HTMLDivElement;
const commandInput = document.getElementById("commandInput") as HTMLInputElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const terminalEl = document.getElementById("terminal") as HTMLDivElement;

function appendLine(kind: "AGENT"|"USER"|"SYSTEM"|"EXEC"|"ERROR"|"SUMMARY", text: string, codeBlock?: string) {
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

// safe JSON parse
function tryParseJSON(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

// locate runCommand in window (support a couple of preload API shapes)
function getRunCommandFn(): ((cmd: string) => Promise<string>) | null {
  const w = window as any;
  if (w.terminal && typeof w.terminal.runCommand === "function") return w.terminal.runCommand.bind(w.terminal);
  if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.runCommand === "function") return w.appAPI.terminal.runCommand.bind(w.appAPI.terminal);
  // fallback: maybe preload exposed a direct function
  if (typeof w.runCommand === "function") return w.runCommand.bind(w);
  return null;
}

const runLocalCommand = async (cmd: string): Promise<string> => {
  const fn = getRunCommandFn();
  if (!fn) throw new Error("Local runCommand API not found in preload (window.terminal or window.appAPI.terminal).");
  // run and return string (stdout/stderr combined). Caller will handle errors.
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
    // Agent may send plain strings or JSON. Try parse first.
    const msg = tryParseJSON(raw);

    if (!msg) {
      // not JSON, print raw
      appendLine("AGENT", raw);
      return;
    }

    // If agent sent a final report (object keyed "final_report"), pretty-print it
    if (msg.final_report) {
      appendLine("SUMMARY", "Final report received:");
      appendLine("SUMMARY", JSON.stringify(msg.final_report, null, 2));
      return;
    }

    // Standard structured messages: many of your logs use { type, topic, message }
    if (msg.type) {
      const t = (msg.type || "").toString();
      const topic = msg.topic ? ` (${msg.topic})` : "";
      const messageText = msg.message ?? (msg.msg ?? "");
      // show plan / info messages nicely
      appendLine("AGENT", `${t}${topic}: ${String(messageText)}`);

      // If this is an EXECUTE_CODE_REQUEST, run the code locally and send back result
      if (t === "EXECUTE_CODE_REQUEST" || msg.type === "EXECUTE_CODE_REQUEST") {
        const code = msg.code ?? "";
        const instructions = msg.instructions ?? "";
        appendLine("AGENT", `Agent requests execution:${topic}`, code || undefined);
        if (instructions) appendLine("AGENT", `Instructions: ${instructions}`);

        // run locally (non-blocking for other messages)
        appendLine("SYSTEM", `Executing requested code locally: ${code}`);
        try {
          const out = await runLocalCommand(code);
          appendLine("EXEC", `Execution output for: ${code}`, out);
          // send result back
          const resultMsg = {
            type: "EXECUTE_CODE_RESULT",
            code,
            output: out,
            success: true,
            // if agent provided an id, echo it back (optional)
            request_id: msg.request_id ?? null
          };
          socket?.send(JSON.stringify(resultMsg));
          appendLine("SYSTEM", `Sent EXECUTE_CODE_RESULT (success) back to agent.`);
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
          try { socket?.send(JSON.stringify(resultMsg)); appendLine("SYSTEM", `Sent EXECUTE_CODE_RESULT (failure) back to agent.`); }
          catch (sendErr) { appendLine("ERROR", `Failed to send execution result back: ${String(sendErr)}`); }
        }
      }
      return;
    }

    // fallback: unknown JSON shape -> pretty print
    appendLine("AGENT", JSON.stringify(msg, null, 2));
  };

  socket.onerror = (e) => {
    appendLine("ERROR", `WebSocket error: ${String(e)}`);
    statusEl.textContent = "WebSocket error (check server)";
  };

  socket.onclose = (ev) => {
    appendLine("SYSTEM", `WebSocket closed: code=${ev.code} reason=${ev.reason || "none"}`);
    statusEl.textContent = "WebSocket disconnected";
    // optionally try reconnect — keep simple for now
  };
}

// UI actions
sendBtn.addEventListener("click", () => {
  const text = commandInput.value.trim();
  if (!text) return;
  // send raw text to agent (like wscat does)
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
  if (e.key === "Enter") { sendBtn.click(); }
});

clearBtn.addEventListener("click", () => {
  terminalEl.innerHTML = "";
  appendLine("SYSTEM", "Cleared terminal.");
});

// start
connectWs(WS_URL);


