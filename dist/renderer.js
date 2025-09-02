"use strict";
// renderer.ts
const WS_URL = "ws://localhost:8000/ws";
const statusEl = document.getElementById("status");
const commandInput = document.getElementById("commandInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const terminalEl = document.getElementById("terminal");
const planListEl = document.getElementById("plan-list");
// Track pending executions by step_id
const pendingExecutions = new Map();
// Terminal append
function appendLine(kind, text, codeBlock) {
    if (text.includes('PROMPT_#END#'))
        return;
    const line = document.createElement("div");
    line.className = "line";
    const time = new Date().toLocaleTimeString();
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `[${time}] `;
    line.appendChild(meta);
    const tag = document.createElement("span");
    tag.textContent = `[${kind}] `;
    tag.className = kind.toLowerCase();
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
function tryParseJSON(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return null;
    }
}
// Locate runCommand in window
function getRunCommandFn() {
    const w = window;
    if (w.terminal && typeof w.terminal.runCommand === "function")
        return w.terminal.runCommand.bind(w.terminal);
    if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.runCommand === "function")
        return w.appAPI.terminal.runCommand.bind(w.appAPI.terminal);
    if (typeof w.runCommand === "function")
        return w.runCommand.bind(w);
    return null;
}
// Run command in local shell via Electron IPC
const runLocalCommand = async (cmd) => {
    const fn = getRunCommandFn();
    if (!fn)
        throw new Error("Local runCommand API not found.");
    return await fn(cmd);
};
// WebSocket
let socket = null;
function connectWs(url = WS_URL) {
    socket = new WebSocket(url);
    statusEl.textContent = `Connecting to ${url}...`;
    socket.onopen = () => {
        statusEl.textContent = `Connected to agent at ${url}`;
        appendLine("SYSTEM", `WebSocket connected to ${url}`);
    };
    socket.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        const msg = tryParseJSON(raw);
        if (!msg) {
            appendLine("AGENT", raw);
            return;
        }
        const type = msg.type ?? "UNKNOWN";
        const stepId = msg.step_id ?? null;
        const requestId = msg.request_id ?? null;
        const data = msg.data ?? {};
        // Handle plan steps
        if (type === "PLAN_STEP" && stepId) {
            const li = document.createElement("li");
            li.textContent = data.description || "Unnamed step";
            li.dataset.execId = stepId;
            li.className = "pending";
            planListEl.appendChild(li);
            planListEl.scrollTop = planListEl.scrollHeight;
            pendingExecutions.set(stepId, li);
            appendLine("PLAN", `Step added: ${data.description}`, undefined);
            return;
        }
        // Handle code to execute
        if (type === "STEP_EXECUTION_REQUEST" && stepId) {
            const code = data.code ?? "";
            const instructions = data.instructions ?? "";
            appendLine("AGENT", `Execution requested for step ${stepId}:`, code);
            if (instructions)
                appendLine("AGENT", `Instructions: ${instructions}`);
            // Auto-run the code
            const li = pendingExecutions.get(stepId);
            if (li)
                li.className = "running";
            try {
                const output = await runLocalCommand(code);
                const success = !output.includes('[ERROR: Command timed out');
                const resultMsg = {
                    type: "EXECUTE_CODE_RESULT",
                    code,
                    output: output.replace('PROMPT_#END#', '').trim(),
                    success,
                    request_id: requestId,
                    step_id: stepId
                };
                socket?.send(JSON.stringify(resultMsg));
                appendLine("EXEC", `Execution finished for step ${stepId}`, output);
                if (li) {
                    li.className = success ? "done" : "failed";
                    li.textContent = `${success ? "✔" : "✖"} ${li.textContent}`;
                    pendingExecutions.delete(stepId);
                }
            }
            catch (err) {
                const errStr = err instanceof Error ? err.message : String(err);
                appendLine("ERROR", `Execution failed for step ${stepId}: ${errStr}`);
                const resultMsg = {
                    type: "EXECUTE_CODE_RESULT",
                    code,
                    output: errStr,
                    success: false,
                    request_id: requestId,
                    step_id: stepId
                };
                socket?.send(JSON.stringify(resultMsg));
                if (li) {
                    li.className = "failed";
                    li.textContent = `✖ ${li.textContent}`;
                    pendingExecutions.delete(stepId);
                }
            }
            return;
        }
        // Handle success/fail updates
        if (type === "STEP_SUCCESS" || type === "STEP_FAIL" || type.startsWith("DEBUG")) {
            appendLine(type, JSON.stringify(data, null, 2));
            const li = stepId ? pendingExecutions.get(stepId) : null;
            if (li) {
                if (type === "STEP_SUCCESS" || type === "DEBUG_SUCCESS") {
                    li.className = "done";
                    li.textContent = `✔ ${li.textContent}`;
                    pendingExecutions.delete(stepId);
                }
                if (type === "STEP_FAIL" || type === "DEBUG_FAIL" || type === "DEBUG_ABORT") {
                    li.className = "failed";
                    li.textContent = `✖ ${li.textContent}`;
                    pendingExecutions.delete(stepId);
                }
            }
            return;
        }
        // Summary report
        if (type === "SUMMARY_REPORT") {
            appendLine("SUMMARY", "Final Summary Report:");
            appendLine("SUMMARY", JSON.stringify(data, null, 2));
            return;
        }
        // Default log
        appendLine("AGENT", JSON.stringify(msg, null, 2));
    };
    socket.onerror = (e) => {
        appendLine("ERROR", `WebSocket error: ${String(e)}`);
        statusEl.textContent = "WebSocket error";
    };
    socket.onclose = (ev) => {
        appendLine("SYSTEM", `WebSocket closed: code=${ev.code} reason=${ev.reason || "none"}`);
        statusEl.textContent = "WebSocket disconnected";
    };
}
// UI actions
sendBtn.addEventListener("click", () => {
    const text = commandInput.value.trim();
    if (!text)
        return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        appendLine("ERROR", "WebSocket is not connected.");
        return;
    }
    socket.send(text);
    appendLine("USER", text);
    commandInput.value = "";
});
commandInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter")
        sendBtn.click();
});
clearBtn.addEventListener("click", () => {
    terminalEl.innerHTML = "";
    planListEl.innerHTML = "";
    pendingExecutions.clear();
    appendLine("SYSTEM", "Terminal and plan cleared.");
});
// Stream CLI output
const w = window;
if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.onStreamOutput === "function") {
    w.appAPI.terminal.onStreamOutput((data) => {
        appendLine(data.isError ? "ERROR" : "EXEC", data.text);
    });
}
// Start WebSocket connection
connectWs(WS_URL);
//# sourceMappingURL=renderer.js.map