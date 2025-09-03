"use strict";
// renderer.ts
const WS_URL = "ws://localhost:8000/ws";
const statusEl = document.getElementById("status");
const commandInput = document.getElementById("commandInput");
const sendBtn = document.getElementById("sendBtn");
const clearBtn = document.getElementById("clearBtn");
const terminalEl = document.getElementById("terminal");
const planListEl = document.getElementById("plan-list");
// ---- state ----
let socket = null;
let currentRequestId = null;
let currentExecutingStepId = null;
const pendingExecutions = new Map(); // plan list items by step_id
const stepPanels = new Map(); // per-step UI panels
let planningSpinnerEl = null;
let summarySpinnerEl = null;
// ---- helpers ----
function lockSend(lock) {
    sendBtn.disabled = lock;
    commandInput.disabled = lock;
}
function appendLine(kind, text, codeBlock) {
    if (typeof text === "string" && text.includes("PROMPT_#END#"))
        return;
    const line = document.createElement("div");
    line.className = "line";
    const time = new Date().toLocaleTimeString();
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `[${time}] `;
    // line.appendChild(meta);
    const tag = document.createElement("span");
    tag.textContent = `[${kind}] `;
    tag.className = kind.toLowerCase();
    // line.appendChild(tag);
    const content = document.createElement("span");
    content.textContent = text;
    line.appendChild(content);
    // if (codeBlock) {
    //   const code = document.createElement("pre");
    //   code.className = "code";
    //   code.textContent = codeBlock;
    //   line.appendChild(code);
    // }
    terminalEl.appendChild(line);
    terminalEl.scrollTop = terminalEl.scrollHeight;
}
function tryParseJSON(s) {
    try {
        return JSON.parse(s);
    }
    catch {
        return null;
    }
}
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
const runLocalCommand = async (cmd) => {
    const fn = getRunCommandFn();
    if (!fn)
        throw new Error("Local runCommand API not found.");
    return await fn(cmd);
};
// ---- tiny UI widgets ----
function makeSpinner(text) {
    const wrap = document.createElement("div");
    wrap.className = "spinner";
    const dot = document.createElement("span");
    dot.className = "spinner-dot";
    dot.textContent = "●";
    const label = document.createElement("span");
    label.className = "spinner-text";
    label.textContent = ` ${text}`;
    wrap.appendChild(dot);
    wrap.appendChild(label);
    return wrap;
}
function completeSpinner(sp, doneText) {
    if (!sp)
        return;
    sp.classList.add("spinner-done");
    const label = sp.querySelector(".spinner-text");
    if (label && doneText)
        label.textContent = ` ${doneText}`;
    // leave it visible but show as completed
}
function makeCollapsible(title, code) {
    const root = document.createElement("div");
    root.className = "collapsible";
    const header = document.createElement("div");
    header.className = "collapsible-header";
    header.textContent = title;
    const chev = document.createElement("span");
    chev.className = "chevron";
    chev.textContent = "▼";
    header.appendChild(chev);
    const body = document.createElement("div");
    body.className = "collapsible-body";
    if (code) {
        const pre = document.createElement("pre");
        pre.className = "code";
        pre.textContent = code;
        body.appendChild(pre);
    }
    header.addEventListener("click", () => {
        body.classList.toggle("collapsed");
        chev.textContent = body.classList.contains("collapsed") ? "▶" : "▼";
    });
    root.appendChild(header);
    root.appendChild(body);
    return { root, body };
}
// create/get a panel for a step
function getOrCreateStepPanel(stepId, description) {
    let panel = stepPanels.get(stepId);
    if (panel)
        return panel;
    panel = document.createElement("div");
    panel.className = "step-panel";
    panel.dataset.stepId = stepId;
    const header = document.createElement("div");
    header.className = "step-header";
    const statusDot = document.createElement("span");
    statusDot.className = "status-dot status-pending";
    const title = document.createElement("span");
    title.className = "step-title";
    title.textContent = `Step ${stepId}${description ? `: ${description}` : ""}`;
    const spinner = makeSpinner("Running...");
    spinner.style.marginLeft = "8px";
    spinner.classList.add("step-spinner");
    header.appendChild(statusDot);
    header.appendChild(title);
    header.appendChild(spinner);
    const body = document.createElement("div");
    body.className = "step-body";
    const reasoningBlock = document.createElement("div");
    reasoningBlock.className = "step-reasoning";
    const codeWrap = document.createElement("div");
    codeWrap.className = "step-code-wrap";
    const outputWrap = document.createElement("div");
    outputWrap.className = "step-output-wrap";
    const outPre = document.createElement("pre");
    outPre.className = "code";
    outPre.dataset.stepOutput = stepId;
    outputWrap.appendChild(outPre);
    body.appendChild(reasoningBlock);
    body.appendChild(codeWrap);
    body.appendChild(outputWrap);
    panel.appendChild(header);
    panel.appendChild(body);
    // insert panel at bottom of terminal (so user sees context)
    terminalEl.appendChild(panel);
    terminalEl.scrollTop = terminalEl.scrollHeight;
    stepPanels.set(stepId, panel);
    return panel;
}
function setStepStatus(stepId, status) {
    const panel = stepPanels.get(stepId);
    if (!panel)
        return;
    const dot = panel.querySelector(".status-dot");
    const spinner = panel.querySelector(".step-spinner");
    if (dot) {
        dot.classList.remove("status-pending", "status-running", "status-success", "status-failed");
        dot.classList.add(`status-${status}`);
    }
    if (spinner) {
        if (status === "running")
            spinner.classList.remove("spinner-done");
        else
            completeSpinner(spinner, status === "success" ? "Done" : status === "failed" ? "Failed" : undefined);
    }
}
// ---- WebSocket ----
function connectWs(url = WS_URL) {
    socket = new WebSocket(url);
    statusEl.textContent = `Connecting to ${url}...`;
    socket.onopen = () => {
        statusEl.textContent = `Connected to agent at ${url}`;
        appendLine("SYSTEM", `AI Agent connected and ready`);
    };
    socket.onmessage = async (ev) => {
        const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
        // handle terminal end sentinel separately
        const endProbe = tryParseJSON(raw);
        if (endProbe && endProbe.__END__ === "__END__") {
            appendLine("SYSTEM", "Workflow complete.");
            lockSend(false); // unlock UI
            currentExecutingStepId = null;
            return;
        }
        const msg = tryParseJSON(raw);
        if (!msg) {
            appendLine("AGENT", raw);
            return;
        }
        const type = msg.type ?? "UNKNOWN";
        const stepId = msg.step_id ?? null;
        const requestId = msg.request_id ?? null;
        const data = msg.data ?? {};
        // keep request id
        if (requestId && !currentRequestId)
            currentRequestId = requestId;
        // 2) PLAN_START → show planning spinner
        if (type === "PLAN_START") {
            planningSpinnerEl = makeSpinner("Analyzing request and creating execution plan...");
            terminalEl.appendChild(planningSpinnerEl);
            terminalEl.scrollTop = terminalEl.scrollHeight;
            return;
        }
        // 3) PLAN_STEPS → complete planning spinner; print steps as "step_id: description"
        if (type === "PLAN_STEPS") {
            completeSpinner(planningSpinnerEl, "Plan created successfully");
            const steps = (data.steps ?? []);
            appendLine("PLAN", "Execution Plan Generated");
            for (const s of steps) {
                // terminal list
                appendLine("PLAN", `${s.step_id}: ${s.description}`);
                // plan sidebar
                const li = document.createElement("li");
                li.textContent = `${s.step_id}: ${s.description}`;
                li.dataset.execId = s.step_id;
                li.className = "pending";
                planListEl.appendChild(li);
                pendingExecutions.set(s.step_id, li);
            }
            planListEl.scrollTop = planListEl.scrollHeight;
            return;
        }
        // 4) PLAN_COMPLETE
        if (type === "PLAN_COMPLETE") {
            appendLine("PLAN", `Planning complete. Total steps: ${data.total_steps}`);
            return;
        }
        // 5) EXEC_INIT
        if (type === "EXEC_INIT") {
            appendLine("SYSTEM", "Executing steps…");
            return;
        }
        // 6) STEP_START → create panel, mark running
        if (type === "STEP_START" && stepId) {
            const desc = data.description || "";
            const panel = getOrCreateStepPanel(stepId, desc);
            setStepStatus(stepId, "running");
            const li = pendingExecutions.get(stepId);
            if (li)
                li.className = "running";
            return;
        }
        // 7) STEP_REASONING → show paragraph in panel
        if (type === "STEP_REASONING" && stepId) {
            const panel = getOrCreateStepPanel(stepId);
            const reason = (data.reasoning ?? data.reason ?? "").toString();
            const block = panel.querySelector(".step-reasoning");
            const p = document.createElement("p");
            p.textContent = reason;
            block.appendChild(p);
            terminalEl.scrollTop = terminalEl.scrollHeight;
            return;
        }
        // 8) STEP_CODE → collapsible code box (expandable)
        if (type === "STEP_CODE" && stepId) {
            const panel = getOrCreateStepPanel(stepId);
            const codeWrap = panel.querySelector(".step-code-wrap");
            codeWrap.innerHTML = "";
            const code = (data.code ?? "").toString();
            const { root, body } = makeCollapsible("Code to execute", code);
            body.classList.add("collapsed"); // start collapsed
            codeWrap.appendChild(root);
            terminalEl.scrollTop = terminalEl.scrollHeight;
            return;
        }
        // 8.5) In case the backend sends STEP_EXECUTION_RESULT (optional display)
        if (type === "STEP_EXECUTION_RESULT" && stepId) {
            const panel = getOrCreateStepPanel(stepId);
            const outPre = panel.querySelector(`pre.code[data-step-output="${stepId}"]`);
            if (outPre) {
                const out = (data.output ?? "").toString();
                outPre.textContent += (outPre.textContent ? "\n" : "") + out;
            }
            return;
        }
        // 9) STEP_EXECUTION_REQUEST → auto run, stream output, send result
        if (type === "STEP_EXECUTION_REQUEST" && stepId) {
            currentExecutingStepId = stepId;
            const li = pendingExecutions.get(stepId);
            if (li)
                li.className = "running";
            const panel = getOrCreateStepPanel(stepId);
            const outPre = panel.querySelector(`pre.code[data-step-output="${stepId}"]`);
            const code = (data.code ?? "").toString();
            try {
                const output = await runLocalCommand(code);
                const cleaned = output.replace("PROMPT_#END#", "").trim();
                const success = !output.includes("[ERROR: Command timed out");
                // also append the final output into the step output box if exists
                if (outPre) {
                    outPre.textContent += (outPre.textContent ? "\n" : "") + cleaned;
                }
                const resultMsg = {
                    type: "EXECUTE_CODE_RESULT",
                    code,
                    output: cleaned,
                    success,
                    request_id: requestId,
                    step_id: stepId
                };
                socket?.send(JSON.stringify(resultMsg));
                appendLine("EXEC", `Step ${stepId} completed successfully`);
                if (li) {
                    li.className = success ? "done" : "failed";
                    li.textContent = `${success ? "✔" : "✖"} ${li.textContent}`;
                    if (success)
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
                }
            }
            finally {
                currentExecutingStepId = null;
            }
            return;
        }
        // 10) STEP_SUCCESS / STEP_FAIL (note: you might sometimes send fields outside data)
        if (type === "STEP_SUCCESS" || type === "STEP_FAIL") {
            const isSuccess = type === "STEP_SUCCESS";
            const message = (data.message ?? msg.message ?? (isSuccess ? "Step succeeded." : "Step failed.")).toString();
            const reasonOrOut = (data.reason ?? msg.reason ?? data.output ?? msg.output ?? "").toString();
            if (stepId) {
                setStepStatus(stepId, isSuccess ? "success" : "failed");
                const li = pendingExecutions.get(stepId);
                if (li) {
                    li.className = isSuccess ? "done" : "failed";
                    li.textContent = `${isSuccess ? "✔" : "✖"} ${li.textContent}`;
                    pendingExecutions.delete(stepId);
                }
            }
            appendLine(isSuccess ? "SUCCESS" : "ERROR", message);
            return;
        }
        // 10.2) DEBUG_* cycle
        if (type === "DEBUG_START" && stepId) {
            const attempt = data.attempt ?? 1;
            const max = data.max_attempts ?? 2;
            appendLine("DEBUG", `Debugging step ${stepId} (attempt ${attempt}/${max})`);
            setStepStatus(stepId, "running");
            return;
        }
        if (type === "DEBUG_REASONING" && stepId) {
            const reason = (data.reasoning ?? "").toString();
            const panel = getOrCreateStepPanel(stepId);
            const p = document.createElement("p");
            p.className = "debug-reason";
            p.textContent = `Debug: ${reason}`;
            panel.querySelector(".step-reasoning")?.appendChild(p);
            return;
        }
        if (type === "DEBUG_CODE" && stepId) {
            const code = (data.code ?? "").toString();
            const panel = getOrCreateStepPanel(stepId);
            const wrap = panel.querySelector(".step-code-wrap");
            // append another collapsible for debug fix
            const { root } = makeCollapsible("Debug code (click to expand/collapse)", code);
            wrap.appendChild(root);
            return;
        }
        if ((type === "DEBUG_SUCCESS" || type === "DEBUG_FAIL" || type === "DEBUG_ABORT") && stepId) {
            if (type === "DEBUG_SUCCESS")
                setStepStatus(stepId, "success");
            if (type === "DEBUG_FAIL" || type === "DEBUG_ABORT")
                setStepStatus(stepId, "failed");
            appendLine("DEBUG", `${type}: ${JSON.stringify(data)}`);
            const li = pendingExecutions.get(stepId);
            if (li) {
                if (type === "DEBUG_SUCCESS") {
                    li.className = "done";
                    li.textContent = `✔ ${li.textContent}`;
                }
                else {
                    li.className = "failed";
                    li.textContent = `✖ ${li.textContent}`;
                }
                pendingExecutions.delete(stepId);
            }
            return;
        }
        // 11) SUMMARY_START → spinner
        if (type === "SUMMARY_START") {
            summarySpinnerEl = makeSpinner("Generating summary...");
            terminalEl.appendChild(summarySpinnerEl);
            terminalEl.scrollTop = terminalEl.scrollHeight;
            return;
        }
        // 12) SUMMARY_REPORT → render key_results (and anything else you want)
        if (type === "SUMMARY_REPORT") {
            completeSpinner(summarySpinnerEl, "Summary ready");
            appendLine("SUMMARY", "Key Results:");
            const keyResults = (data.key_results ?? []);
            for (const k of keyResults)
                appendLine("SUMMARY", `• ${k}`);
            return;
        }
        // 13) REQUEST_COMPLETE → stop summary loading
        if (type === "REQUEST_COMPLETE") {
            completeSpinner(summarySpinnerEl, "Finished");
            return;
        }
        // default: dump
        // appendLine("AGENT", JSON.stringify(msg, null, 2));
    };
    socket.onerror = (e) => {
        appendLine("ERROR", `WebSocket error: ${String(e)}`);
        statusEl.textContent = "WebSocket error - Check if AI agent server is running";
        lockSend(false);
    };
    socket.onclose = (ev) => {
        appendLine("SYSTEM", `Connection closed: ${ev.reason || "Disconnected from AI agent"}`);
        statusEl.textContent = "Disconnected - Click connect to retry";
        lockSend(false);
    };
}
// ---- UI actions ----
sendBtn.addEventListener("click", () => {
    const text = commandInput.value.trim();
    if (!text)
        return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        appendLine("ERROR", "WebSocket is not connected to AI agent.");
        return;
    }
    const text_fix = ">> " + text;
    appendLine("USER", text_fix);
    socket.send(text);
    commandInput.value = "";
    lockSend(true);
});
commandInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter")
        sendBtn.click();
});
clearBtn.addEventListener("click", () => {
    terminalEl.innerHTML = "";
    planListEl.innerHTML = "";
    pendingExecutions.clear();
    stepPanels.clear();
    planningSpinnerEl = null;
    summarySpinnerEl = null;
    appendLine("SYSTEM", "Terminal and plan cleared.");
});
// ---- stream CLI output (route also into current step panel if set) ----
const w = window;
if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.onStreamOutput === "function") {
    w.appAPI.terminal.onStreamOutput((data) => {
        if (currentExecutingStepId) {
            const panel = stepPanels.get(currentExecutingStepId);
            const outPre = panel?.querySelector(`pre.code[data-step-output="${currentExecutingStepId}"]`);
            if (outPre) {
                outPre.textContent += data.text.replace("PROMPT_#END#", "");
            }
        }
    });
}
// Add connection retry button
const connectBtn = document.getElementById("connectBtn");
connectBtn?.addEventListener("click", () => {
    if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
    }
    connectWs(WS_URL);
});
// ---- start ----
connectWs(WS_URL);
//# sourceMappingURL=renderer.js.map