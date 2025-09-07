const WS_URL = "ws://localhost:8000/ws ";

const statusEl = document.getElementById("status") as HTMLDivElement;
const commandInput = document.getElementById("commandInput") as HTMLInputElement;
const sendBtn = document.getElementById("sendBtn") as HTMLButtonElement;
const clearBtn = document.getElementById("clearBtn") as HTMLButtonElement;
const terminalEl = document.getElementById("terminal") as HTMLDivElement;
const planListEl = document.getElementById("plan-list") as HTMLUListElement;
const promptPathEl = document.getElementById("promptPath") as HTMLSpanElement;
const sidebarToggle = document.getElementById("sidebarToggle") as HTMLButtonElement;
const sidebar = document.getElementById("sidebar") as HTMLDivElement;
const closeBtn = document.querySelector(".control-button.close");
const minBtn = document.querySelector(".control-button.minimize");
const maxBtn = document.querySelector(".control-button.maximize");


// Settings modal elements
const settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;
const settingsModal = document.getElementById("settingsModal") as HTMLDivElement;
const closeSettings = document.getElementById("closeSettings") as HTMLButtonElement;
const themeSelect = document.getElementById("themeSelect") as HTMLSelectElement;
const fontSizeSlider = document.getElementById("fontSizeSlider") as HTMLInputElement;
const fontSizeValue = document.getElementById("fontSizeValue") as HTMLSpanElement;
const transparencySlider = document.getElementById("transparencySlider") as HTMLInputElement;
const transparencyValue = document.getElementById("transparencyValue") as HTMLSpanElement;

// ---- state ----
let socket: WebSocket | null = null;
let currentRequestId: string | null = null;
let currentExecutingStepId: string | null = null;
let currentDir = "";

const pendingExecutions = new Map<string, HTMLLIElement>(); // plan list items by step_id
const stepPanels = new Map<string, Map<string, HTMLElement>>();           // per-step UI panels
let planningSpinnerEl: HTMLElement | null = null;
let summarySpinnerEl: HTMLElement | null = null;

// const convert = new AnsiToHtml();
// ---- helpers ----
function lockSend(lock: boolean) {
  sendBtn.disabled = lock;
  commandInput.disabled = lock;

  // Update send button visual state
  if (lock) {
    sendBtn.style.opacity = '0.5';
    sendBtn.style.cursor = 'not-allowed';
  } else {
    sendBtn.style.opacity = '1';
    sendBtn.style.cursor = 'pointer';
  }
}

function updatePrompt() {
  if (promptPathEl && currentDir) {
    // Show just the directory name for cleaner UI
    const dirName = currentDir.split('/').pop() || currentDir;
    promptPathEl.textContent = "dinith@kali:~"+currentDir;
  }
}

function appendLine(kind: string, text: string, codeBlock?: string) {
  if (typeof text === "string" && text.includes("PROMPT_#END#")) return;

  const line = document.createElement("div");
  line.className = `line ${kind.toLowerCase()}`;

  const time = new Date().toLocaleTimeString();
  const meta = document.createElement("span");
  meta.className = "meta";
  meta.textContent = `[${time}] `;

  const tag = document.createElement("span");
  tag.textContent = `[${kind}] `;
  tag.className = kind.toLowerCase();

  const content = document.createElement("span");
  content.textContent = text;

  // line.appendChild(meta);
  // line.appendChild(tag);
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

// Typewriter effect for system info
// function typewriterLine(kind: string, text: string, delay: number = 0): Promise<void> {
//   return new Promise(resolve => {
//     const line = document.createElement("div");
//     line.className = "line";

//     const tag = document.createElement("span");
//     tag.textContent = `[${kind}] `;
//     tag.className = kind.toLowerCase();

//     const content = document.createElement("span");
//     line.appendChild(tag);
//     line.appendChild(content);

//     terminalEl.appendChild(line);

//     let index = 0;
//     const timer = setInterval(() => {
//       if (index < text.length) {
//         content.textContent += text[index];
//         index++;
//         terminalEl.scrollTop = terminalEl.scrollHeight;
//       } else {
//         clearInterval(timer);
//         resolve();
//       }
//     }, delay);
//   });
// }

const startpanel = document.createElement("div");
startpanel.className = "typewriter-panel";
const start_body = document.createElement("div");
start_body.className = "typewriter-body";
startpanel.appendChild(start_body);

// Append panel to terminal
terminalEl.appendChild(startpanel);
terminalEl.scrollTop = terminalEl.scrollHeight;


async function typewriterPanel(kind: string, text: string, delay: number = 1): Promise<HTMLElement> {
  // Create a container div similar to step panel but simpler

  // Typewriter effect
  let index = 0;
  return new Promise(resolve => {
    const timer = setInterval(async () => {

      // body.textContent +=text;
      if (index < 1) {
        // const char = text[index];

        const html = await window.appAPI.asni.ansiToHtml(text);
        const pre = document.createElement("pre");
        pre.innerHTML = html;
        pre.style.whiteSpace = "pre"; // preserve all spaces and line breaks
        pre.style.fontFamily = "monospace"; // terminal-like font

        start_body.appendChild(pre);
        index++;
        terminalEl.scrollTop = terminalEl.scrollHeight;
      } else {
        clearInterval(timer);
        resolve(startpanel); // return the panel for further use if needed
      }
    });
  });

  // return new Promise(resolve => {
  //   body.textContent = text;
  // })
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

function getOrCreateStepPanel(requestId: string, stepId: string, description?: string): HTMLElement {
  if (!stepPanels.has(requestId)) {
    stepPanels.set(requestId, new Map<string, HTMLElement>());
  }
  const requestPanels = stepPanels.get(requestId)!;

  if (requestPanels.has(stepId)) {
    return requestPanels.get(stepId)!;
  }

  const panel = document.createElement("div");
  panel.className = "step-panel";
  panel.dataset.stepId = stepId;
  panel.dataset.requestId = requestId;

  const header = document.createElement("div");
  header.className = "step-header";

  const statusDot = document.createElement("span");
  statusDot.className = "status-dot status-pending";

  const title = document.createElement("span");
  title.className = "step-title";
  title.textContent = `Step ${stepId}${description ? `: ${description}` : ""}`;

  const spinner = makeSpinner("Running...");
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
  outPre.dataset.stepOutput = `${requestId}:${stepId}`;
  outputWrap.appendChild(outPre);

  body.appendChild(reasoningBlock);
  body.appendChild(codeWrap);
  body.appendChild(outputWrap);

  panel.appendChild(header);
  panel.appendChild(body);

  terminalEl.appendChild(panel);
  terminalEl.scrollTop = terminalEl.scrollHeight;

  requestPanels.set(stepId, panel);
  return panel;
}

function setStepStatus(requestId: string, stepId: string, status: "pending" | "running" | "success" | "failed") {
  const panel = stepPanels.get(requestId)?.get(stepId);
  if (!panel) return;

  const dot = panel.querySelector(".status-dot") as HTMLElement | null;
  const spinner = panel.querySelector(".step-spinner") as HTMLElement | null;

  if (dot) {
    dot.classList.remove("status-pending", "status-running", "status-success", "status-failed");
    dot.classList.add(`status-${status}`);
  }

  if (spinner) {
    if (status === "running" || status === "pending") {
      spinner.classList.remove("spinner-done");
    } else {
      completeSpinner(
        spinner,
        status === "success" ? "Done" :
          status === "failed" ? "Failed" : undefined
      );
    }
  }
}

async function showStartupInfo() {
  try {
    // appendLine("SYSTEM", "Initializing futuristic terminal...");

    // Add a small delay for visual effect
    await new Promise(resolve => setTimeout(resolve, 500));

    // Run fastfetch for system info
    const x = "screenfetch"
    const output = await runLocalCommand(x);
    const lines = output.split("\n");

    // Display system info with typewriter effect
    for (const line of lines) {
      if (!line.includes("PROMPT_#END#") && !line.includes("_CURRENT_DIR:")) {
        await typewriterPanel("SYSTEM", line, 20);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Get initial directory
    const dirOutput = await runLocalCommand("pwd");
    const dirLines = dirOutput.split("\n");
    for (const line of dirLines) {
      if (line.trim() && !line.includes("PROMPT_#END#") && !line.startsWith("_CURRENT_DIR:")) {
        currentDir = line.trim();
        break;
      }
      if (line.startsWith("_CURRENT_DIR:")) {
        currentDir = line.replace("_CURRENT_DIR:", "").trim();
        break;
      }
    }

    updatePrompt();
    // appendLine("SYSTEM", `Current directory: ${currentDir}`);
    // appendLine("SYSTEM", "Terminal ready for AI-powered commands");

  } catch (err) {
    const errStr = err instanceof Error ? err.message : String(err);
    appendLine("ERROR", `Failed to run startup info: ${errStr}`);

    // Fallback - at least get the directory
    try {
      const dirOutput = await runLocalCommand("pwd");
      const lines = dirOutput.split("\n");
      for (const line of lines) {
        if (line.trim() && !line.includes("PROMPT_#END#") && !line.startsWith("_CURRENT_DIR:")) {
          currentDir = line.trim();
          break;
        }
      }
      updatePrompt();
    } catch {
      currentDir = "~";
      updatePrompt();
    }
  }
}

// ---- WebSocket ----
function connectWs(url = WS_URL) {
  statusEl.textContent = `Connecting to AI agent...`;

  socket = new WebSocket(url);

  socket.onopen = async () => {
    statusEl.textContent = `Connected to ` + url;
    const statusDot = document.querySelector(".status-dot") as HTMLElement;
    if (statusDot) statusDot.className = "status-dot connected";

    const output = await runLocalCommand("pwd");
    const lines = output.split("\n");
    const currentDirLine = lines.find(line => line.startsWith("_CURRENT_DIR:"));
    if (currentDirLine) currentDir = currentDirLine.replace("_CURRENT_DIR:", "").trim();
    updatePrompt()
    // Show startup info first
    await showStartupInfo();
  };

  socket.onmessage = async (ev: MessageEvent) => {
    const raw = typeof ev.data === "string" ? ev.data : String(ev.data);

    // Handle terminal end sentinel
    const endProbe = tryParseJSON(raw);
    if (endProbe && endProbe.__END__ === "__END__") {
      appendLine("SYSTEM", "\n");
      lockSend(false);
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

    currentRequestId = requestId;

    // Handle different message types
    switch (type) {
      case "PLAN_START":
        planningSpinnerEl = makeSpinner("Analyzing request and creating execution plan...");
        terminalEl.appendChild(planningSpinnerEl);
        terminalEl.scrollTop = terminalEl.scrollHeight;
        break;

      case "PLAN_STEPS":
        completeSpinner(planningSpinnerEl, "Plan created successfully");
        const steps = (data.steps ?? []) as Array<{ step_id: string; description: string }>;
        appendLine("PLAN", "Execution Plan Generated");

        for (const s of steps) {
          appendLine("PLAN", `${s.step_id}: ${s.description}`);

          const li = document.createElement("li");
          li.textContent = `${s.step_id}: ${s.description}`;
          li.dataset.execId = s.step_id;
          li.className = "pending";
          planListEl.appendChild(li);
          pendingExecutions.set(s.step_id, li);
        }
        planListEl.scrollTop = planListEl.scrollHeight;
        break;

      case "PLAN_COMPLETE":
        appendLine("PLAN", `Planning complete. Total steps: ${data.total_steps}`);
        break;

      case "EXEC_INIT":
        appendLine("SYSTEM", "Executing steps…");
        break;

      case "STEP_START":
        if (stepId) {
          const desc = data.description || "";
          const panel = getOrCreateStepPanel(requestId, stepId, desc);
          setStepStatus(requestId, stepId, "running");
          const li = pendingExecutions.get(stepId);
          if (li) li.className = "running";
        }
        break;

      case "STEP_REASONING":
        if (stepId) {
          const panel = getOrCreateStepPanel(requestId, stepId);
          const reason = (data.reasoning ?? data.reason ?? "").toString();
          const block = panel.querySelector(".step-reasoning") as HTMLElement;
          const p = document.createElement("p");
          p.textContent = reason;
          block.appendChild(p);
          terminalEl.scrollTop = terminalEl.scrollHeight;
        }
        break;

      case "STEP_CODE":
        if (stepId) {
          const panel = getOrCreateStepPanel(requestId, stepId);
          const codeWrap = panel.querySelector(".step-code-wrap") as HTMLElement;
          codeWrap.innerHTML = "";
          const code = (data.code ?? "").toString();
          const { root, body } = makeCollapsible("Code to execute", code);
          body.classList.add("collapsed");
          codeWrap.appendChild(root);
          terminalEl.scrollTop = terminalEl.scrollHeight;
        }
        break;

      case "STEP_EXECUTION_RESULT":
        if (stepId) {
          const panel = getOrCreateStepPanel(requestId, stepId);
          const outPre = panel.querySelector(`pre.code[data-step-output="${requestId}:${stepId}"]`) as HTMLPreElement | null;
          if (outPre) {
            const out = (data.output ?? "").toString();
            outPre.textContent += (outPre.textContent ? "\n" : "") + out;
          }
        }
        break;

      case "STEP_EXECUTION_REQUEST":
        if (stepId) {
          currentExecutingStepId = stepId;
          const li = pendingExecutions.get(stepId);
          if (li) li.className = "running";

          const panel = getOrCreateStepPanel(requestId, stepId);
          const outPre = panel.querySelector(`pre.code[data-step-output="${requestId}:${stepId}"]`) as HTMLPreElement | null;
          const code = (data.code ?? "").toString();

          try {
            const output = await runLocalCommand(code);
            const lines = output.split("\n");

            // Clean output and extract directory
            while (lines.length) {
              const lastLine = lines[lines.length - 1]?.trim() ?? "";
              if (lastLine === "PROMPT_#END#") {
                lines.pop();
              } else if (lastLine.startsWith("_CURRENT_DIR:")) {
                currentDir = lastLine.replace("_CURRENT_DIR:", "").trim();
                updatePrompt();
                lines.pop();
              } else {
                break;
              }
            }

            const cleaned = lines.join("\n").trim();
            const success = !output.includes("[ERROR: Command timed out");

            if (outPre && cleaned) {
              outPre.textContent += (outPre.textContent ? "\n" : "");
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
        }
        break;

      case "STEP_SUCCESS":
      case "STEP_FAIL":
        const isSuccess = type === "STEP_SUCCESS";
        const message = (data.message ?? msg.message ?? (isSuccess ? "Step succeeded." : "Step failed.")).toString();

        if (stepId) {
          setStepStatus(requestId, stepId, isSuccess ? "success" : "failed");
          const li = pendingExecutions.get(stepId);
          if (li) {
            li.className = isSuccess ? "done" : "failed";
            li.textContent = `${isSuccess ? "✔" : "✖"} ${li.textContent}`;
            pendingExecutions.delete(stepId);
          }
        }

        appendLine(isSuccess ? "SUCCESS" : "ERROR", message);
        break;

      case "DEBUG_START":
        if (stepId) {
          const attempt = data.attempt ?? 1;
          const max = data.max_attempts ?? 2;
          appendLine("DEBUG", `Debugging step ${stepId} (attempt ${attempt}/${max})`);
          setStepStatus(requestId, stepId, "running");
        }
        break;

      case "DEBUG_REASONING":
        if (stepId) {
          const reason = (data.reasoning ?? "").toString();
          const panel = getOrCreateStepPanel(requestId, stepId);
          const p = document.createElement("p");
          p.className = "debug-reason";
          p.textContent = `Debug: ${reason}`;
          panel.querySelector(".step-reasoning")?.appendChild(p);
        }
        break;

      case "DEBUG_CODE":
        if (stepId) {
          const code = (data.code ?? "").toString();
          const panel = getOrCreateStepPanel(requestId, stepId);
          const wrap = panel.querySelector(".step-code-wrap") as HTMLElement;
          const { root } = makeCollapsible("Debug code (click to expand/collapse)", code);
          wrap.appendChild(root);
        }
        break;

      case "DEBUG_SUCCESS":
      case "DEBUG_FAIL":
      case "DEBUG_ABORT":
        if (stepId) {
          if (type === "DEBUG_SUCCESS") setStepStatus(requestId, stepId, "success");
          if (type === "DEBUG_FAIL" || type === "DEBUG_ABORT") setStepStatus(requestId, stepId, "failed");
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
        }
        break;

      case "SUMMARY_START":
        summarySpinnerEl = makeSpinner("Generating summary...");
        terminalEl.appendChild(summarySpinnerEl);
        terminalEl.scrollTop = terminalEl.scrollHeight;
        break;

      case "SUMMARY_REPORT":
        completeSpinner(summarySpinnerEl, "Summary ready");
        appendLine("SUMMARY", "Key Results:");
        const keyResults = (data.key_results ?? []) as string[];
        for (const k of keyResults) {
          appendLine("SUMMARY", `• ${k}`);
        }
        break;

      case "REQUEST_COMPLETE":
        completeSpinner(summarySpinnerEl, "Finished");
        break;

      default:
        // appendLine("AGENT", JSON.stringify(msg, null, 2));
        break;
    }
  };

  socket.onerror = (e) => {
    appendLine("ERROR", `WebSocket error: ${String(e)}`);
    statusEl.textContent = "WebSocket error - Check if AI agent server is running";
    const statusDot = document.querySelector(".status-dot") as HTMLElement;
    if (statusDot) statusDot.className = "status-dot disconnected";
    lockSend(false);
  };

  socket.onclose = (ev) => {
    appendLine("SYSTEM", `Connection closed: ${ev.reason || "Disconnected from AI agent"}`);
    statusEl.textContent = "Disconnected - Click reconnect to retry";
    const statusDot = document.querySelector(".status-dot") as HTMLElement;
    if (statusDot) statusDot.className = "status-dot disconnected";
    lockSend(false);
  };
}

// ---- UI Event Handlers ----
sendBtn.addEventListener("click", () => {
  const text = commandInput.value.trim();
  if (!text) return;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    appendLine("ERROR", "WebSocket is not connected to AI agent.");
    return;
  }

  appendLine("USER", `${currentDir} : ${text}`);
  socket.send(text);
  commandInput.value = "";
  lockSend(true);
});


commandInput.addEventListener('input', () => {
  commandInput.style.height = 'auto'; // reset height
  commandInput.style.height = commandInput.scrollHeight + 'px'; // set new height
});


commandInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    sendBtn.click();
  }
});

clearBtn.addEventListener("click", () => {
  clearBtn.classList.add('clearing');
  terminalEl.innerHTML = "";
  planListEl.innerHTML = "";
  pendingExecutions.clear();
  stepPanels.clear();
  planningSpinnerEl = null;
  summarySpinnerEl = null;
  setTimeout(() => {
    clearBtn.classList.remove('clearing');
  }, 300); // match animation duration
  // appendLine("SYSTEM", "Terminal and plan cleared.");
});

// Sidebar toggle
sidebarToggle.addEventListener("click", () => {
  sidebar.classList.toggle("collapsed");
  const chevron = sidebarToggle.querySelector("svg");
  if (chevron) {
    if (sidebar.classList.contains("collapsed")) {
      chevron.style.transform = "rotate(180deg)";
    } else {
      chevron.style.transform = "rotate(0deg)";
    }
  }
});

// Settings modal handlers
settingsBtn.addEventListener("click", () => {
  settingsModal.classList.add("active");
});

closeSettings.addEventListener("click", () => {
  settingsModal.classList.remove("active");
});

settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.classList.remove("active");
  }
});

// Theme toggle
themeSelect.addEventListener("change", () => {
  document.body.setAttribute("data-theme", themeSelect.value);
  localStorage.setItem("theme", themeSelect.value);
});

// Font size control
fontSizeSlider.addEventListener("input", () => {
  const size = fontSizeSlider.value + "px";
  document.documentElement.style.setProperty("--font-size-md", size);
  fontSizeValue.textContent = size;
  localStorage.setItem("fontSize", fontSizeSlider.value);
});

// Transparency control
transparencySlider.addEventListener("input", () => {
  const opacity = parseInt(transparencySlider.value) / 100;
  document.documentElement.style.setProperty("--bg-primary", `rgba(11, 15, 25, ${opacity})`);
  document.documentElement.style.setProperty("--bg-secondary", `rgba(15, 20, 30, ${opacity})`);
  transparencyValue.textContent = transparencySlider.value + "%";
  localStorage.setItem("transparency", transparencySlider.value);
});


closeBtn?.addEventListener("click", () => {
  window.appAPI.windowControl("close");
});

minBtn?.addEventListener("click", () => {
  window.appAPI.windowControl("minimize");
});

maxBtn?.addEventListener("click", () => {
  window.appAPI.windowControl("maximize");
});


// Load saved settings
function loadSettings() {
  const savedTheme = localStorage.getItem("theme") || "dark";
  const savedFontSize = localStorage.getItem("fontSize") || "14";
  const savedTransparency = localStorage.getItem("transparency") || "85";

  themeSelect.value = savedTheme;
  document.body.setAttribute("data-theme", savedTheme);

  fontSizeSlider.value = savedFontSize;
  fontSizeValue.textContent = savedFontSize + "px";
  document.documentElement.style.setProperty("--font-size-md", savedFontSize + "px");

  transparencySlider.value = savedTransparency;
  transparencyValue.textContent = savedTransparency + "%";
  const opacity = parseInt(savedTransparency) / 100;
  document.documentElement.style.setProperty("--bg-primary", `rgba(11, 15, 25, ${opacity})`);
  document.documentElement.style.setProperty("--bg-secondary", `rgba(15, 20, 30, ${opacity})`);
}

// Connection retry handler
const connectBtn = document.getElementById("connectBtn") as HTMLButtonElement;
connectBtn?.addEventListener("click", () => {
  connectBtn.classList.add('reconnecting');
  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.close();
  }
  connectWs(WS_URL);
  setTimeout(() => {
    connectBtn.classList.remove('reconnecting');
  }, 3000);
});

// Stream output handler
const w = window as any;
if (w.appAPI && w.appAPI.terminal && typeof w.appAPI.terminal.onStreamOutput === "function") {
  w.appAPI.terminal.onStreamOutput((data: { text: string; isError: boolean }) => {
    if (currentRequestId && currentExecutingStepId) {
      const panel = stepPanels.get(currentRequestId)?.get(currentExecutingStepId);
      const outPre = panel?.querySelector(
        `pre.code[data-step-output="${currentRequestId}:${currentExecutingStepId}"]`
      ) as HTMLPreElement | null;

      if (outPre) {
        const lines = data.text.split("\n");

        // Clean output
        while (lines.length) {
          const lastLine = lines[lines.length - 1];
          const last = lastLine !== undefined ? lastLine.trim() : "";

          if (last === "PROMPT_#END#") {
            lines.pop();
          } else if (last.startsWith("_CURRENT_DIR:")) {
            currentDir = last.replace("_CURRENT_DIR:", "").trim();
            updatePrompt();
            lines.pop();
          } else if (last === "") {
            lines.pop();
          } else {
            break;
          }
        }

        console.log("---------------------------------")
        console.log(lines)
        console.log("---------------------------------")


        const cleanText = lines.join("\n");
        console.log("cleanText----", cleanText)
        // console.log("cleanText----",cleanText)
        if (cleanText) {
          outPre.textContent += cleanText + "\n";
        }

      }
    }
  });
}

// Initialize
loadSettings();
connectWs(WS_URL);