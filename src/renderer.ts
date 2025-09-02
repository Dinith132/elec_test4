// renderer.ts
const WS_URL = "ws://localhost:8000/ws";

const statusEl = document.getElementById("status") as HTMLDivElement;
const commandInput = document.getElementById("commandInput") as HTMLInputElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const terminalEl = document.getElementById("terminal") as HTMLDivElement;
const planListEl = document.getElementById("plan-list") as HTMLUListElement;

// ---- state ----
let socket: WebSocket | null = null;
let currentRequestId: string | null = null;
let currentExecutingStepId: string | null = null;

const pendingExecutions = new Map<string, HTMLLIElement>(); // plan list items by step_id
const stepPanels = new Map<string, HTMLElement>();           // per-step UI panels
let planningSpinnerEl: HTMLElement | null = null;
let summarySpinnerEl: HTMLElement | null = null;

// ---- helpers ----
function lockSend(lock: boolean) {
  sendBtn.disabled = lock;
  commandInput.disabled = lock;
}

function appendLine(kind: string, text: string, codeBlock?: string) {
  if (typeof text === "string" && text.includes("PROMPT_#END#")) return;

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

function tryParseJSON(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

function getRunCommandFn(): ((cmd: string) => Promise<string>) | null {
  const w = window as any;
  if (w.terminal && typeof w.terminal.runCommand === "function") return w.terminal.runCommand.bind(w.terminal);
  if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.runCommand === "function") return w.appAPI.terminal.runCommand.bind(w.appAPI.terminal);
  if (typeof w.runCommand === "function") return w.runCommand.bind(w);
  return null;
}

const runLocalCommand = async (cmd: string): Promise<string> => {
  const fn = getRunCommandFn();
  if (!fn) throw new Error("Local runCommand API not found.");
  return await fn(cmd);
};

// ---- tiny UI widgets ----
function makeSpinner(text: string): HTMLElement {
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

function completeSpinner(sp: HTMLElement | null, doneText?: string) {
  if (!sp) return;
  sp.classList.add("spinner-done");
  const label = sp.querySelector(".spinner-text") as HTMLElement | null;
  if (label && doneText) label.textContent = ` ${doneText}`;
  // leave it visible but show as completed
}

function makeCollapsible(title: string, code?: string): { root: HTMLElement; body: HTMLElement } {
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
function getOrCreateStepPanel(stepId: string, description?: string): HTMLElement {
  let panel = stepPanels.get(stepId);
  if (panel) return panel;

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
  // const outTitle = document.createElement("div");
  // outTitle.className = "section-title";
  // outTitle.textContent = "Output (live)";
  const outPre = document.createElement("pre");
  outPre.className = "code";
  outPre.dataset.stepOutput = stepId;
  // outputWrap.appendChild(outTitle);
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

function setStepStatus(stepId: string, status: "pending" | "running" | "success" | "failed") {
  const panel = stepPanels.get(stepId);
  if (!panel) return;
  const dot = panel.querySelector(".status-dot") as HTMLElement | null;
  const spinner = panel.querySelector(".step-spinner") as HTMLElement | null;

  if (dot) {
    dot.classList.remove("status-pending", "status-running", "status-success", "status-failed");
    dot.classList.add(`status-${status}`);
  }
  if (spinner) {
    if (status === "running") spinner.classList.remove("spinner-done");
    else completeSpinner(spinner, status === "success" ? "Done" : status === "failed" ? "Failed" : undefined);
  }
}

// ---- WebSocket ----
function connectWs(url = WS_URL) {
  socket = new WebSocket(url);
  statusEl.textContent = `Connecting to ${url}...`;

  socket.onopen = () => {
    statusEl.textContent = `Connected to agent at ${url}`;
    // appendLine("SYSTEM", `WebSocket connected to ${url}`); 
  };

  socket.onmessage = async (ev: MessageEvent) => {
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
    if (!msg) { appendLine("AGENT_test", raw); return; }

    const type = msg.type ?? "UNKNOWN";
    const stepId = msg.step_id ?? null;
    const requestId = msg.request_id ?? null;
    const data = msg.data ?? {};

    // keep request id
    if (requestId && !currentRequestId) currentRequestId = requestId;

    // 1) user locked earlier when sending (see send handler)

    // 2) PLAN_START → show planning spinner
    if (type === "PLAN_START") {
      planningSpinnerEl = makeSpinner("Loading planning agent...");
      terminalEl.appendChild(planningSpinnerEl);
      terminalEl.scrollTop = terminalEl.scrollHeight;
      // appendLine("PLAN", "Planning started.");
      return;
    }

    // 3) PLAN_STEPS → complete planning spinner; print steps as "step_id: description"
    if (type === "PLAN_STEPS") {
      completeSpinner(planningSpinnerEl, "Loaded the Planning Agent");
      const steps = (data.steps ?? []) as Array<{ step_id: string; description: string }>;
      appendLine("PLAN", "Execution Plan");
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
      // appendLine("AGENT", `Step ${stepId} started: ${desc}`);
      const panel = getOrCreateStepPanel(stepId, desc);
      setStepStatus(stepId, "running");
      const li = pendingExecutions.get(stepId);
      if (li) li.className = "running";
      return;
    }

    // 7) STEP_REASONING → show paragraph in panel
    if (type === "STEP_REASONING" && stepId) {
      const panel = getOrCreateStepPanel(stepId);
      const reason = (data.reasoning ?? data.reason ?? "").toString();
      const block = panel.querySelector(".step-reasoning") as HTMLElement;
      const p = document.createElement("p");
      p.textContent = reason;
      block.appendChild(p);
      terminalEl.scrollTop = terminalEl.scrollHeight;
      return;
    }

    // 8) STEP_CODE → collapsible code box (expandable)
    if (type === "STEP_CODE" && stepId) {
      const panel = getOrCreateStepPanel(stepId);
      const codeWrap = panel.querySelector(".step-code-wrap") as HTMLElement;
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
      const outPre = panel.querySelector(`pre.code[data-step-output="${stepId}"]`) as HTMLPreElement | null;
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
      if (li) li.className = "running";

      const panel = getOrCreateStepPanel(stepId);
      const outPre = panel.querySelector(`pre.code[data-step-output="${stepId}"]`) as HTMLPreElement | null;

      const code = (data.code ?? "").toString();
      // appendLine("AGENT", `Execution requested for step ${stepId}:`, code);

      try {
        const output = await runLocalCommand(code);
        const cleaned = output.replace("PROMPT_#END#", "").trim();
        const success = !output.includes("[ERROR: Command timed out");

        // also append the final output into the step output box if exists
        if (outPre) {
          outPre.textContent += (outPre.textContent ? "\n" : "") ;
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

        // appendLine("EXEC", `Execution finished for step ${stepId}`);

        if (li) {
          li.className = success ? "done" : "failed";
          li.textContent = `${success ? "✔" : "✖"} ${li.textContent}`;
          if (success) pendingExecutions.delete(stepId);
        }
      } catch (err) {
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
      } finally {
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
      // if (reasonOrOut) appendLine("AGENT", reasonOrOut);
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
      const wrap = panel.querySelector(".step-code-wrap") as HTMLElement;
      // append another collapsible for debug fix
      const { root } = makeCollapsible("Debug code (click to expand/collapse)", code);
      wrap.appendChild(root);
      return;
    }

    if ((type === "DEBUG_SUCCESS" || type === "DEBUG_FAIL" || type === "DEBUG_ABORT") && stepId) {
      if (type === "DEBUG_SUCCESS") setStepStatus(stepId, "success");
      if (type === "DEBUG_FAIL" || type === "DEBUG_ABORT") setStepStatus(stepId, "failed");
      appendLine("DEBUG", `${type}: ${JSON.stringify(data)}`);
      const li = pendingExecutions.get(stepId);
      if (li) {
        if (type === "DEBUG_SUCCESS") {
          li.className = "done";
          li.textContent = `✔ ${li.textContent}`;
        } else {
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
      const keyResults = (data.key_results ?? []) as string[];
      for (const k of keyResults) appendLine("SUMMARY", `• ${k}`);
      return;
    }

    // 13) REQUEST_COMPLETE → stop summary loading
    if (type === "REQUEST_COMPLETE") {
      completeSpinner(summarySpinnerEl, "Finished");
      // appendLine("SYSTEM", `Request ${requestId || ""} complete.`);
      return;
    }

    // default: dump
    // appendLine("AGENT", JSON.stringify(msg, null, 2));
  };

  socket.onerror = (e) => {
    appendLine("ERROR", `WebSocket error: ${String(e)}`);
    statusEl.textContent = "WebSocket error";
    lockSend(false);
  };

  socket.onclose = (ev) => {
    appendLine("SYSTEM", `WebSocket closed: code=${ev.code} reason=${ev.reason || "none"}`);
    statusEl.textContent = "WebSocket disconnected";
    lockSend(false);
  };
}

// ---- UI actions ----
sendBtn.addEventListener("click", () => {
  const text = commandInput.value.trim();
  if (!text) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendLine("ERROR", "WebSocket is not connected.");
    return;
  }
  // 1) user enters message → show and lock until __END__
  const text_fix=">> "+text;
  appendLine("USER", text_fix);
  socket.send(text);
  commandInput.value = "";
  lockSend(true);
});

commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn.click();
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
const w = window as any;
if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.onStreamOutput === "function") {
  w.appAPI.terminal.onStreamOutput((data: { text: string; isError: boolean }) => {
    appendLine(data.isError ? "ERROR" : "EXEC", data.text);
    if (currentExecutingStepId) {
      const panel = stepPanels.get(currentExecutingStepId);
      const outPre = panel?.querySelector(`pre.code[data-step-output="${currentExecutingStepId}"]`) as HTMLPreElement | null;
      if (outPre) {
        outPre.textContent += data.text.replace("PROMPT_#END#", "");
      }
    }
  });
}

// ---- start ----
connectWs(WS_URL);

/* ---------- OPTIONAL CSS (put in your stylesheet) ----------
.spinner { display: inline-flex; align-items: center; opacity: 0.9; }
.spinner-dot { animation: blink 1s infinite; }
.spinner-done .spinner-dot { animation: none; opacity: 0.4; }
.spinner-text { font-style: italic; }
@keyframes blink { 0% { opacity: 0.1; } 50% { opacity: 1; } 100% { opacity: 0.1; } }

.step-panel { border: 1px solid #444; border-radius: 6px; padding: 8px; margin: 8px 0; background: #232323; }
.step-header { display: flex; align-items: center; gap: 8px; }
.status-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.status-pending { background: #777; }
.status-running { background: #0a84ff; }
.status-success { background: #28a745; }
.status-failed { background: #dc3545; }
.step-title { font-weight: bold; }

.section-title { font-weight: bold; margin: 6px 0; }

.collapsible { margin-top: 6px; border: 1px solid #555; border-radius: 6px; }
.collapsible-header { padding: 6px; cursor: pointer; user-select: none; display: flex; justify-content: space-between; }
.collapsible-body { padding: 6px; }
.collapsible-body.collapsed { display: none; }
.chevron { opacity: 0.7; }

.code { background-color: #222; color: #0f0; padding: 6px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; }

.plan-list .pending { background: #555; }
.plan-list .running { background: #0a84ff; }
.plan-list .done { background: #28a745; }
.plan-list .failed { background: #dc3545; }
--------------------------------------------------------------*/
