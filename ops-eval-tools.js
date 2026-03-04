/* =========================================================
   ops-eval-tools.js
   Adds:
   - Golden Prompt Regression Runner (uses /golden_prompts.json)
   - Conversation Simulator (optional /conversation_scenarios.json)
   Non-invasive: uses existing DOM ids and clicks the existing Run button.
   ========================================================= */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    q: $("q"),
    runBtn: $("runBtn"),
    statusText: $("statusText"),
    guestOut: $("guestOut"),
    rawOut: $("rawOut"),
    metaGrid: $("metaGrid"),
  };

  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function status(){ return (els.statusText?.textContent || "").trim(); }

  async function waitForDone(timeoutMs = 90000){
    const start = Date.now();
    while (Date.now() - start < timeoutMs){
      const s = status();
      if (s === "Done" || s === "Stream ended" || s === "Fetch error" || s === "Stopped" || s === "Fetch error (not SSE)") return s;
      await sleep(180);
    }
    return "Timeout";
  }

  async function runQuestion(question){
    if (!els.q || !els.runBtn) throw new Error("Missing #q or #runBtn");
    els.q.value = question;
    els.runBtn.click();
    const endStatus = await waitForDone();
    return {
      endStatus,
      question,
      guest: (els.guestOut?.textContent || "").trim(),
      raw: (els.rawOut?.textContent || "").trim(),
      metaText: (els.metaGrid?.innerText || "").trim(),
      at: new Date().toISOString()
    };
  }

  function normalizeGoldenItem(item){
    const prompt = item.prompt || item.question || "";
    const expect = item.expect || item.expected_keywords || item.keywords || [];
    const id = item.id || prompt.slice(0, 40).toLowerCase().replace(/\s+/g,"_");
    return { id, prompt, expect: Array.isArray(expect) ? expect : [] };
  }

  function keywordScore(text, keywords){
    const t = (text || "").toLowerCase();
    if (!keywords.length) return { score: 1, matched: [], missing: [] };
    const matched = [];
    const missing = [];
    for (const k of keywords){
      const kk = String(k || "").toLowerCase();
      if (!kk) continue;
      (t.includes(kk) ? matched : missing).push(k);
    }
    const score = (matched.length) / (matched.length + missing.length || 1);
    return { score, matched, missing };
  }

  // ---------- UI ----------
  function makeBtn(label){
    const b = document.createElement("button");
    b.className = "btn btn--util";
    b.type = "button";
    b.textContent = label;
    return b;
  }

  function injectUI(){
    // Find the existing button row
    const row = els.runBtn?.closest(".row") || els.runBtn?.parentElement;
    if (!row) return;

    const goldenBtn = makeBtn("Run Golden");
    goldenBtn.id = "vvGoldenBtn";

    const simBtn = makeBtn("Simulate");
    simBtn.id = "vvSimBtn";

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
          <div class="vv-eval__hint">Runs multi-step guest journeys (default set built-in; optional <code>/conversation_scenarios.json</code>).</div>
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

    // Insert buttons beside existing ones (after Clear)
    row.appendChild(goldenBtn);
    row.appendChild(simBtn);

    // Inject panel at end of wrap
    const wrap = document.querySelector(".wrap") || document.body;
    wrap.appendChild(panel);

    const openPanel = () => panel.classList.add("is-open");
    const closePanel = () => panel.classList.remove("is-open");

    goldenBtn.addEventListener("click", () => {
      openPanel();
      activateTab("golden");
    });

    simBtn.addEventListener("click", async () => {
      openPanel();
      activateTab("sim");
      await loadScenarios();
    });

    $("#vvEvalClose").addEventListener("click", closePanel);

    const tabGolden = $("#vvTabGolden");
    const tabSim = $("#vvTabSim");
    const goldenView = $("#vvGoldenView");
    const simView = $("#vvSimView");

    function activateTab(which){
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

    tabGolden.addEventListener("click", () => activateTab("golden"));
    tabSim.addEventListener("click", async () => { activateTab("sim"); await loadScenarios(); });

    // Wire actions
    wireGolden();
    wireSim();
  }

  // ---------- Golden Runner ----------
  let goldenAbort = false;

  async function loadGolden(){
    const res = await fetch("/golden_prompts.json", { cache: "no-store" });
    if (!res.ok) throw new Error("Missing /golden_prompts.json");
    const arr = await res.json();
    return (Array.isArray(arr) ? arr : []).map(normalizeGoldenItem).filter(x => x.prompt);
  }

  function renderGolden(results){
    const out = $("#vvGoldenOut");
    if (!out) return;
    const passCount = results.filter(r => r.pass).length;
    const avg = results.length ? (results.reduce((a,r)=>a+r.score,0)/results.length) : 0;

    const rows = results.map(r => `
      <tr class="${r.pass ? "is-pass":"is-fail"}">
        <td class="mono">${r.id}</td>
        <td>${r.prompt}</td>
        <td class="mono">${r.score.toFixed(2)}</td>
        <td>${r.pass ? "PASS" : "FAIL"}</td>
        <td class="mono">${r.missing.join(", ")}</td>
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
          <thead>
            <tr>
              <th>ID</th>
              <th>Prompt</th>
              <th>Score</th>
              <th>Status</th>
              <th>Missing keywords</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function wireGolden(){
    const run = $("#vvGoldenRun");
    const stop = $("#vvGoldenStop");
    if (!run || !stop) return;

    run.addEventListener("click", async () => {
      goldenAbort = false;
      run.disabled = true;
      stop.disabled = false;

      const out = $("#vvGoldenOut");
      if (out) out.innerHTML = `<div class="vv-eval__hint">Running golden prompts…</div>`;

      let suite;
      try {
        suite = await loadGolden();
      } catch (e) {
        if (out) out.innerHTML = `<div class="vv-eval__hint">Error: ${String(e.message || e)}</div>`;
        run.disabled = false;
        stop.disabled = true;
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

      run.disabled = false;
      stop.disabled = true;

      if (goldenAbort){
        const out2 = $("#vvGoldenOut");
        if (out2) out2.insertAdjacentHTML("afterbegin", `<div class="vv-eval__hint">Stopped.</div>`);
      }
    });

    stop.addEventListener("click", () => {
      goldenAbort = true;
      stop.disabled = true;
    });
  }

  // ---------- Conversation Simulator ----------
  const DEFAULT_SCENARIOS = [
    {
      id: "beach_journey",
      name: "Beach day journey",
      steps: [
        "How far is the closest beach from the villa?",
        "Can I walk there from the villa?",
        "Can the concierge set up chairs and drinks there?"
      ]
    },
    {
      id: "booking_journey",
      name: "Booking journey",
      steps: [
        "What are your rates or availability?",
        "What about May 13–May 23?",
        "Can you help us book and coordinate special requests?"
      ]
    }
  ];

  let scenariosCache = null;
  let simAbort = false;

  async function loadScenarios(){
    if (scenariosCache) return scenariosCache;
    let scenarios = [...DEFAULT_SCENARIOS];

    try {
      const res = await fetch("/conversation_scenarios.json", { cache: "no-store" });
      if (res.ok){
        const arr = await res.json();
        if (Array.isArray(arr)){
          scenarios = arr
            .map(s => ({
              id: s.id || (s.name || "scenario").toLowerCase().replace(/\s+/g,"_"),
              name: s.name || s.id || "Scenario",
              steps: Array.isArray(s.steps) ? s.steps : []
            }))
            .filter(s => s.steps.length);
        }
      }
    } catch (_) {}

    scenariosCache = scenarios;
    const sel = $("#vvScenarioSelect");
    if (sel){
      sel.innerHTML = scenarios.map(s => `<option value="${s.id}">${s.name}</option>`).join("");
    }
    return scenarios;
  }

  function renderTranscript(items){
    const out = $("#vvSimOut");
    if (!out) return;
    const html = items.map(x => `
      <div class="vv-turn">
        <div class="vv-turn__role">${x.role}</div>
        <div class="vv-turn__text">${escapeHtml(x.text).replace(/\n/g,"<br>")}</div>
      </div>
    `).join("");
    out.innerHTML = `<div class="vv-transcript">${html}</div>`;
  }

  function escapeHtml(s){
    return String(s || "")
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;")
      .replace(/'/g,"&#039;");
  }

  function wireSim(){
    const run = $("#vvSimRun");
    const stop = $("#vvSimStop");
    if (!run || !stop) return;

    run.addEventListener("click", async () => {
      simAbort = false;
      run.disabled = true;
      stop.disabled = false;

      const out = $("#vvSimOut");
      if (out) out.innerHTML = `<div class="vv-eval__hint">Running scenario…</div>`;

      const scenarios = await loadScenarios();
      const sel = $("#vvScenarioSelect");
      const id = sel ? sel.value : scenarios[0]?.id;
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

      run.disabled = false;
      stop.disabled = true;

      if (simAbort){
        const out2 = $("#vvSimOut");
        if (out2) out2.insertAdjacentHTML("afterbegin", `<div class="vv-eval__hint">Stopped.</div>`);
      }
    });

    stop.addEventListener("click", () => {
      simAbort = true;
      stop.disabled = true;
    });
  }

  // Init
  function boot(){
    // Only boot if the ops console ids exist
    if (!els.runBtn || !els.q) return;
    injectUI();
  }

  if (document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();