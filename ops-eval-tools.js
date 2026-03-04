/* =========================================================
   ops-eval-tools.js (FIXED / RESILIENT)
   - Golden Prompt Regression Runner
   - Conversation Simulator
   Works across different ops console DOM ids by probing candidates.
   ========================================================= */
(() => {
  "use strict";

  const idFirst = (ids) => {
    for (const id of ids){
      const el = document.getElementById(id);
      if (el) return el;
    }
    return null;
  };

  const qEl = () => idFirst(["prompt","q","question","promptInput"]);
  const runEl = () => idFirst(["run","runBtn","runButton"]);
  const statusEl = () => idFirst(["statusText","status","fetchStatus","state","runStatus"]);
  const guestEl = () => idFirst(["guest-view","guestOut","guest","answer","output","guestView"]);
  const rawEl = () => idFirst(["raw-view","rawOut","raw","sse","rawSSE","rawView"]);
  const metaEl = () => idFirst(["meta-view","metaGrid","meta","metaOut","metaView"]);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  function getStatus(){
    const el = statusEl();
    return (el?.textContent || "").trim();
  }

  async function waitForCompletion(timeoutMs=90000){
    const start = Date.now();
    let lastGuest = (guestEl()?.textContent || "").trim();
    let stableMs = 0;

    while (Date.now() - start < timeoutMs){
      const s = getStatus();
      // treat these as terminal if present
      if (["Done","Stream ended","Stopped","Timeout","Fetch error","Fetch Error"].includes(s)) return s;

      const g = (guestEl()?.textContent || "").trim();
      if (g !== lastGuest){
        lastGuest = g;
        stableMs = 0;
      } else {
        stableMs += 200;
      }

      // If status element doesn't exist (or never changes), consider "stable output" as done.
      // When output hasn't changed for ~1.8s AND we have some guest text, assume finished.
      if (!statusEl() && g && stableMs >= 1800) return "Done";

      await sleep(200);
    }
    return "Timeout";
  }

  async function runQuestion(question){
    const q = qEl();
    const run = runEl();
    if (!q || !run) throw new Error("Ops eval tools: couldn't find prompt input or Run button.");

    q.value = question;
    run.click();

    const endStatus = await waitForCompletion();

    return {
      at: new Date().toISOString(),
      endStatus,
      prompt: question,
      guest: (guestEl()?.textContent || "").trim(),
      metaText: (metaEl()?.innerText || metaEl()?.textContent || "").trim(),
      raw: (rawEl()?.textContent || "").trim(),
    };
  }

  // ---------- Golden ----------
  const normalizeGoldenItem = (item) => {
    const prompt = item.prompt || item.question || "";
    const expect = item.expect || item.expected_keywords || item.keywords || [];
    const id = item.id || prompt.slice(0, 48).toLowerCase().replace(/\s+/g,"_");
    return { id, prompt, expect: Array.isArray(expect) ? expect : [] };
  };

  const keywordScore = (text, keywords) => {
    const t = (text || "").toLowerCase();
    if (!keywords.length) return { score: 1, matched: [], missing: [] };
    const matched = [];
    const missing = [];
    for (const k of keywords){
      const kk = String(k || "").toLowerCase();
      if (!kk) continue;
      (t.includes(kk) ? matched : missing).push(k);
    }
    const denom = matched.length + missing.length || 1;
    return { score: matched.length/denom, matched, missing };
  };

  async function loadGolden(){
    const res = await fetch("/golden_prompts.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Missing /golden_prompts.json");
    const arr = await res.json();
    return (Array.isArray(arr) ? arr : []).map(normalizeGoldenItem).filter(x => x.prompt);
  }

  // ---------- Simulator ----------
  const DEFAULT_SCENARIOS = [
    { id:"beach_journey", name:"Beach day journey", steps:[
      "How far is the closest beach from the villa?",
      "Can I walk there from the villa?",
      "Can the concierge set up chairs and drinks there?"
    ]},
    { id:"golf_cart_journey", name:"Golf carts + transport", steps:[
      "Do you have golf carts on property?",
      "Can you arrange a ride to a quieter tropical beach?",
      "Can you help us plan a full beach day setup?"
    ]}
  ];

  let scenariosCache = null;

  async function loadScenarios(){
    if (scenariosCache) return scenariosCache;
    let scenarios = [...DEFAULT_SCENARIOS];
    try {
      const res = await fetch("/conversation_scenarios.json", { cache: "no-store" });
      if (res.ok){
        const arr = await res.json();
        if (Array.isArray(arr)){
          scenarios = arr.map(s => ({
            id: s.id || (s.name || "scenario").toLowerCase().replace(/\s+/g,"_"),
            name: s.name || s.id || "Scenario",
            steps: Array.isArray(s.steps) ? s.steps : []
          })).filter(s => s.steps.length);
        }
      }
    } catch(_){}
    scenariosCache = scenarios;
    return scenarios;
  }

  // ---------- UI ----------
  const makeBtn = (label) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn--util";
    b.textContent = label;
    return b;
  };

  function escapeHtml(s){
    return String(s || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;").replace(/'/g,"&#039;");
  }

  function injectUI(){
    const run = runEl();
    if (!run) return;

    const row = run.closest(".row") || run.parentElement || document.body;

    const goldenBtn = makeBtn("Run Golden");
    goldenBtn.id = "vvGoldenBtn";
    const simBtn = makeBtn("Simulate");
    simBtn.id = "vvSimBtn";

    row.appendChild(goldenBtn);
    row.appendChild(simBtn);

    const panel = document.createElement("section");
    panel.className = "vv-eval";
    panel.id = "vvEvalPanel";
    panel.innerHTML = `
      <div class="vv-eval__head">
        <div class="vv-eval__title">Evaluation</div>
        <div class="vv-eval__actions">
          <button class="btn btn--util" id="vvEvalClose" type="button">Close</button>
        </div>
      </div>

      <div class="vv-eval__tabs">
        <button class="vv-tab is-active" id="vvTabGolden" type="button">Golden Runner</button>
        <button class="vv-tab" id="vvTabSim" type="button">Conversation Simulator</button>
      </div>

      <div class="vv-eval__body">
        <div id="vvGoldenView">
          <div class="vv-eval__hint">Runs prompts from <code>/golden_prompts.json</code> and scores keyword coverage.</div>
          <div class="vv-eval__controls">
            <button class="btn btn--util" id="vvGoldenRun" type="button">Run Golden Suite</button>
            <button class="btn btn--util" id="vvGoldenStop" type="button" disabled>Stop</button>
          </div>
          <div class="vv-eval__out" id="vvGoldenOut"></div>
        </div>

        <div id="vvSimView" style="display:none;">
          <div class="vv-eval__hint">Runs multi-step guest journeys (uses <code>/conversation_scenarios.json</code> if present).</div>
          <div class="vv-eval__controls">
            <label class="vv-label">Scenario</label>
            <select id="vvScenarioSelect" class="vv-select"></select>
            <button class="btn btn--util" id="vvSimRun" type="button">Run Scenario</button>
            <button class="btn btn--util" id="vvSimStop" type="button" disabled>Stop</button>
          </div>
          <div class="vv-eval__out" id="vvSimOut"></div>
        </div>
      </div>
    `;

    (document.querySelector(".wrap") || document.body).appendChild(panel);

    const openPanel = () => panel.classList.add("is-open");
    const closePanel = () => panel.classList.remove("is-open");

    const tabGolden = document.getElementById("vvTabGolden");
    const tabSim = document.getElementById("vvTabSim");
    const goldenView = document.getElementById("vvGoldenView");
    const simView = document.getElementById("vvSimView");

    function activate(which){
      if (which === "golden"){
        tabGolden.classList.add("is-active");
        tabSim.classList.remove("is-active");
        goldenView.style.display = "";
        simView.style.display = "none";
      } else {
        tabSim.classList.add("is-active");
        tabGolden.classList.remove("is-active");
        simView.style.display = "";
        goldenView.style.display = "none";
      }
    }

    document.getElementById("vvEvalClose").addEventListener("click", closePanel);

    goldenBtn.addEventListener("click", () => { openPanel(); activate("golden"); });
    simBtn.addEventListener("click", async () => { openPanel(); activate("sim"); await populateScenarios(); });

    tabGolden.addEventListener("click", () => activate("golden"));
    tabSim.addEventListener("click", async () => { activate("sim"); await populateScenarios(); });

    wireGolden();
    wireSim();
  }

  // ---------- Golden wiring ----------
  let goldenAbort = false;

  function renderGolden(results){
    const out = document.getElementById("vvGoldenOut");
    if (!out) return;
    const passCount = results.filter(r => r.pass).length;
    const avg = results.length ? (results.reduce((a,r)=>a+r.score,0)/results.length) : 0;

    const rows = results.map(r => `
      <tr class="${r.pass ? "is-pass":"is-fail"}">
        <td class="mono">${escapeHtml(r.id)}</td>
        <td>${escapeHtml(r.prompt)}</td>
        <td class="mono">${r.score.toFixed(2)}</td>
        <td>${r.pass ? "PASS" : "FAIL"}</td>
        <td class="mono">${escapeHtml(r.missing.join(", "))}</td>
      </tr>
    `).join("");

    out.innerHTML = `
      <div class="vv-kpis">
        <div class="vv-kpi"><div class="k">Total</div><div class="v">${results.length}</div></div>
        <div class="vv-kpi"><div class="k">Pass</div><div class="v">${passCount}</div></div>
        <div class="vv-kpi"><div class="k">Avg score</div><div class="v">${avg.toFixed(2)}</div></div>
      </div>
      <div class="vv-table-wrap">
        <table class="vv-table">
          <thead><tr><th>ID</th><th>Prompt</th><th>Score</th><th>Status</th><th>Missing</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function wireGolden(){
    const runBtn = document.getElementById("vvGoldenRun");
    const stopBtn = document.getElementById("vvGoldenStop");
    if (!runBtn || !stopBtn) return;

    runBtn.addEventListener("click", async () => {
      goldenAbort = false;
      runBtn.disabled = true;
      stopBtn.disabled = false;

      const out = document.getElementById("vvGoldenOut");
      if (out) out.innerHTML = `<div class="vv-eval__hint">Running golden prompts…</div>`;

      let suite;
      try {
        suite = await loadGolden();
      } catch (e) {
        if (out) out.innerHTML = `<div class="vv-eval__hint">Error: ${escapeHtml(String(e.message || e))}</div>`;
        runBtn.disabled = false;
        stopBtn.disabled = true;
        return;
      }

      const results = [];
      for (const item of suite){
        if (goldenAbort) break;

        const r = await runQuestion(item.prompt);
        const s = keywordScore(r.guest, item.expect);
        const score = s.score;
        const pass = score >= 0.66;

        results.push({
          id: item.id,
          prompt: item.prompt,
          score,
          pass,
          missing: s.missing,
          endStatus: r.endStatus,
          at: r.at
        });

        renderGolden(results);
        await sleep(220);
      }

      runBtn.disabled = false;
      stopBtn.disabled = true;
      if (goldenAbort && out) out.insertAdjacentHTML("afterbegin", `<div class="vv-eval__hint">Stopped.</div>`);
    });

    stopBtn.addEventListener("click", () => {
      goldenAbort = true;
      stopBtn.disabled = true;
    });
  }

  // ---------- Simulator wiring ----------
  let simAbort = false;

  async function populateScenarios(){
    const sel = document.getElementById("vvScenarioSelect");
    if (!sel) return;
    const scenarios = await loadScenarios();
    sel.innerHTML = scenarios.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join("");
  }

  function renderTranscript(items){
    const out = document.getElementById("vvSimOut");
    if (!out) return;
    out.innerHTML = `<div class="vv-transcript">${
      items.map(x => `
        <div class="vv-turn">
          <div class="vv-turn__role">${escapeHtml(x.role)}</div>
          <div class="vv-turn__text">${escapeHtml(x.text).replace(/\n/g,"<br>")}</div>
        </div>
      `).join("")
    }</div>`;
  }

  function wireSim(){
    const runBtn = document.getElementById("vvSimRun");
    const stopBtn = document.getElementById("vvSimStop");
    if (!runBtn || !stopBtn) return;

    runBtn.addEventListener("click", async () => {
      simAbort = false;
      runBtn.disabled = true;
      stopBtn.disabled = false;

      const out = document.getElementById("vvSimOut");
      if (out) out.innerHTML = `<div class="vv-eval__hint">Running scenario…</div>`;

      const scenarios = await loadScenarios();
      const sel = document.getElementById("vvScenarioSelect");
      const id = sel?.value || scenarios[0]?.id;
      const scenario = scenarios.find(s => s.id === id) || scenarios[0];

      const transcript = [];
      for (const step of scenario.steps){
        if (simAbort) break;

        transcript.push({ role: "Guest", text: step });
        renderTranscript(transcript);

        const r = await runQuestion(step);
        transcript.push({ role: "Concierge", text: r.guest || "(no response)" });
        renderTranscript(transcript);

        await sleep(260);
      }

      runBtn.disabled = false;
      stopBtn.disabled = true;
      if (simAbort && out) out.insertAdjacentHTML("afterbegin", `<div class="vv-eval__hint">Stopped.</div>`);
    });

    stopBtn.addEventListener("click", () => {
      simAbort = true;
      stopBtn.disabled = true;
    });
  }

  function boot(){
    if (!qEl() || !runEl()) return;
    injectUI();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();