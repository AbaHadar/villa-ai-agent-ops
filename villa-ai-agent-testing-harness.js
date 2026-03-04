/* villa-ai-agent-testing-harness.js
   Villa Valentín — AI Concierge Ops Console
   SSE test harness (Netlify Functions /ask)
   + Run Ledger (IndexedDB), Copy Bundle, Copy Last Run, Ratings/Notes, Test Suite, Export
*/
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const els = {
    endpoint: $("endpoint"),
    q: $("q"),
    runBtn: $("runBtn"),
    stopBtn: $("stopBtn"),
    clearBtn: $("clearBtn"),
    statusText: $("statusText"),
    guestOut: $("guestOut"),
    rawOut: $("rawOut"),
    metaGrid: $("metaGrid"),
    ctaContainer: $("ctaContainer"),
  };

  // -----------------------------
  // Run Ledger (IndexedDB)
  // -----------------------------
  const LEDGER = {
    dbName: "vv-ai-agent-ops",
    store: "runs",
    version: 1,
    maxRuns: 5000,
  };

  function ptNowISO() {
    // Returns a friendly PT timestamp string plus ISO UTC
    const now = new Date();
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    return { ts_iso: now.toISOString(), ts_pt: fmt.format(now).replace(",", "") + " PT" };
  }

  function uuid() {
    // Best effort (crypto.randomUUID when available)
    try {
      if (crypto?.randomUUID) return crypto.randomUUID();
    } catch {}
    return "run_" + Math.random().toString(16).slice(2) + "_" + Date.now();
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(LEDGER.dbName, LEDGER.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(LEDGER.store)) {
          const store = db.createObjectStore(LEDGER.store, { keyPath: "id" });
          store.createIndex("ts_iso", "ts_iso", { unique: false });
          store.createIndex("prompt", "prompt", { unique: false });
          store.createIndex("best_score", "derived.best_score", { unique: false });
          store.createIndex("mode", "derived.mode", { unique: false });
          store.createIndex("calendar_used", "derived.calendar_used", { unique: false });
          store.createIndex("rating", "rating", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPutRun(run) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LEDGER.store, "readwrite");
      tx.objectStore(LEDGER.store).put(run);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbGetRun(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LEDGER.store, "readonly");
      const req = tx.objectStore(LEDGER.store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbListRuns(limit = 200) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const out = [];
      const tx = db.transaction(LEDGER.store, "readonly");
      const idx = tx.objectStore(LEDGER.store).index("ts_iso");
      // Descending by ts_iso: openCursor with "prev"
      const req = idx.openCursor(null, "prev");
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        out.push(cur.value);
        if (out.length >= limit) return resolve(out);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbCountRuns() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(LEDGER.store, "readonly");
      const req = tx.objectStore(LEDGER.store).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbTrimIfNeeded() {
    // Keep last maxRuns by ts_iso
    const count = await dbCountRuns();
    if (count <= LEDGER.maxRuns) return;

    const db = await openDB();
    const toDelete = count - LEDGER.maxRuns;

    return new Promise((resolve, reject) => {
      const tx = db.transaction(LEDGER.store, "readwrite");
      const idx = tx.objectStore(LEDGER.store).index("ts_iso");
      // Oldest first: "next"
      let deleted = 0;
      const req = idx.openCursor(null, "next");
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(true);
        cur.delete();
        deleted++;
        if (deleted >= toDelete) return resolve(true);
        cur.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  function derive(run) {
    const meta = run?.meta || {};
    const lcUsed = !!(meta.live_calendar && meta.live_calendar.used);
    const stay = !!meta.stay_booking_intent;
    const exp = !!meta.experience_intent;
    const mode = stay ? "booking" : (exp ? "experience" : "concierge");

    const best = (typeof meta.best_score === "number") ? meta.best_score : null;

    return {
      mode,
      calendar_used: lcUsed,
      best_score: best,
      confidence: meta.confidence || null,
      date_specific: typeof meta.date_specific !== "undefined" ? !!meta.date_specific : null,
      has_date_range: typeof meta.has_date_range !== "undefined" ? !!meta.has_date_range : null,
      request_id: meta.request_id || null,
      started_at: meta.started_at || null,
    };
  }

  function safeJsonParse(line) {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  async function copyToClipboard(text) {
    const s = String(text || "");
    try {
      await navigator.clipboard.writeText(s);
      return true;
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = s;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        document.body.removeChild(ta);
        return true;
      } catch {
        document.body.removeChild(ta);
        return false;
      }
    }
  }

  function downloadText(filename, content) {
    const blob = new Blob([String(content || "")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 0);
  }

  // -----------------------------
  // UI helpers
  // -----------------------------
  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
  }

  function setButtons() {
    if (!els.runBtn || !els.stopBtn) return;
    els.runBtn.disabled = state.running;
    els.stopBtn.disabled = !state.running;
  }

  function appendRaw(line) {
    state.rawLines.push(line);
    if (state.rawLines.length > 3000) state.rawLines.shift();
    if (els.rawOut) els.rawOut.textContent = state.rawLines.join("\n");
  }

  function setGuest(text) {
    state.guestText = text || "";
    if (els.guestOut) els.guestOut.textContent = state.guestText || "(waiting...)";
  }

  function clearMeta() {
    if (els.metaGrid) els.metaGrid.innerHTML = "";
  }

  function clearCTAs() {
    if (els.ctaContainer) els.ctaContainer.innerHTML = "";
  }

  function addMetaCard(k, v) {
    if (!els.metaGrid) return;
    const card = document.createElement("div");
    card.className = "metaCard";
    card.innerHTML = `<div class="k">${escapeHtml(String(k))}</div><div class="v">${escapeHtml(String(v))}</div>`;
    els.metaGrid.appendChild(card);
  }

  function addCTA(cta) {
    if (!els.ctaContainer || !cta) return;

    const a = document.createElement("a");
    a.className = "ctaBtn";
    a.href = cta.url || "#";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = cta.label || cta.type || "CTA";

    const small = document.createElement("span");
    small.className = "ctaType";
    small.textContent = cta.type ? ` (${cta.type})` : "";
    a.appendChild(small);

    els.ctaContainer.appendChild(a);
  }

  function normalizeEndpoint(url) {
    const u = (url || "").trim();
    return u.replace(/\/+$/, "");
  }

  // -----------------------------
  // State for a single run
  // -----------------------------
  const state = {
    controller: null,
    running: false,
    guestText: "",
    rawLines: [],
    runCtx: null,          // current run context
    lastRun: null,         // last completed run record
    suiteRunning: false,
  };

  function clearAll() {
    setGuest("");
    state.rawLines = [];
    if (els.rawOut) els.rawOut.textContent = "(no events yet)";
    clearMeta();
    clearCTAs();
    setStatus("Idle");
  }

  /**
   * stop({ keepStatus: true, noAbort: true })
   * - noAbort: do not abort fetch/controller (used when stream ended normally)
   */
  function stop(opts = {}) {
    if (state.controller && !opts.noAbort) {
      try {
        state.controller.abort();
      } catch {}
    }
    state.controller = null;
    state.running = false;
    setButtons();
    if (!opts.keepStatus) setStatus("Stopped");

    if (state.runCtx && typeof state.runCtx.resolve === "function" && !state.runCtx.resolved) {
      // If user manually stopped, resolve with null so suites can proceed safely.
      state.runCtx.resolved = true;
      state.runCtx.resolve(null);
    }
  }

  // -----------------------------
  // Run Ledger UI (panel + buttons)
  // -----------------------------
  let ui = {
    btnCopyLast: null,
    btnRuns: null,
    btnExportJsonl: null,
    btnExportCsv: null,
    btnRunSuite: null,
    panel: null,
    list: null,
    detail: null,
    search: null,
    filterMode: null,
    filterCal: null,
    filterRating: null,
    runsCount: null,
    suiteEditor: null,
  };

  function ensureLedgerStyles() {
    if (document.getElementById("vvLedgerStyles")) return;
    const style = document.createElement("style");
    style.id = "vvLedgerStyles";
    style.textContent = `
      .vvLedgerBtn{ margin-left:8px; padding:8px 10px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); color:inherit; border-radius:10px; cursor:pointer; font:inherit; }
      .vvLedgerBtn:disabled{ opacity:.55; cursor:not-allowed; }
      .vvLedgerPanel{ position:fixed; right:16px; top:16px; bottom:16px; width:520px; max-width:92vw; background:rgba(16,16,16,.96); color:#f5f5f5; border:1px solid rgba(255,255,255,.12); border-radius:16px; box-shadow:0 24px 80px rgba(0,0,0,.45); z-index:99999; display:none; overflow:hidden; }
      .vvLedgerPanel.open{ display:flex; flex-direction:column; }
      .vvLedgerHeader{ display:flex; align-items:center; gap:10px; padding:12px 12px; border-bottom:1px solid rgba(255,255,255,.10); }
      .vvLedgerHeader .title{ font-weight:700; letter-spacing:.2px; }
      .vvLedgerHeader .count{ opacity:.8; font-size:12px; }
      .vvLedgerHeader .spacer{ flex:1; }
      .vvLedgerHeader input, .vvLedgerHeader select{ background:rgba(255,255,255,.06); color:#fff; border:1px solid rgba(255,255,255,.12); border-radius:10px; padding:8px 10px; font:inherit; }
      .vvLedgerBody{ display:grid; grid-template-columns: 1fr 1.25fr; height:100%; }
      .vvLedgerList{ border-right:1px solid rgba(255,255,255,.10); overflow:auto; }
      .vvLedgerDetail{ overflow:auto; padding:12px; }
      .vvRunRow{ padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.08); cursor:pointer; }
      .vvRunRow:hover{ background:rgba(255,255,255,.05); }
      .vvRunRow.active{ background:rgba(255,255,255,.08); }
      .vvRunTop{ display:flex; align-items:center; gap:8px; }
      .vvBadge{ font-size:11px; padding:2px 8px; border-radius:999px; border:1px solid rgba(255,255,255,.14); opacity:.9; }
      .vvPrompt{ margin-top:6px; font-size:12px; opacity:.95; line-height:1.25; }
      .vvTiny{ font-size:11px; opacity:.75; margin-left:auto; }
      .vvDetailTitle{ font-size:12px; opacity:.8; margin-top:10px; margin-bottom:6px; }
      .vvDetailBox{ white-space:pre-wrap; font-size:12px; line-height:1.25; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.10); border-radius:12px; padding:10px; }
      .vvDetailActions{ display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; }
      .vvDetailActions button{ padding:8px 10px; border-radius:10px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); color:#fff; cursor:pointer; }
      .vvStars button{ padding:6px 8px; }
      .vvNote{ width:100%; min-height:80px; background:rgba(255,255,255,.06); color:#fff; border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:10px; font:inherit; }
      .vvSuiteWrap{ margin-top:12px; }
      .vvSuiteWrap textarea{ width:100%; min-height:140px; background:rgba(255,255,255,.06); color:#fff; border:1px solid rgba(255,255,255,.12); border-radius:12px; padding:10px; font:inherit; }
    `;
    document.head.appendChild(style);
  }

  function insertLedgerButtons() {
    if (!els.runBtn) return;
    const bar = els.runBtn.parentElement || document.body;

    ui.btnCopyLast = document.createElement("button");
    ui.btnCopyLast.className = "vvLedgerBtn";
    ui.btnCopyLast.type = "button";
    ui.btnCopyLast.textContent = "Copy last run";
    ui.btnCopyLast.addEventListener("click", async () => {
      if (!state.lastRun) {
        setStatus("No runs yet");
        return;
      }
      const ok = await copyToClipboard(JSON.stringify(state.lastRun.bundle, null, 2));
      setStatus(ok ? "Copied last run" : "Copy failed");
    });

    ui.btnRuns = document.createElement("button");
    ui.btnRuns.className = "vvLedgerBtn";
    ui.btnRuns.type = "button";
    ui.btnRuns.textContent = "Runs";
    ui.btnRuns.addEventListener("click", toggleRunsPanel);

    ui.btnExportJsonl = document.createElement("button");
    ui.btnExportJsonl.className = "vvLedgerBtn";
    ui.btnExportJsonl.type = "button";
    ui.btnExportJsonl.textContent = "Export JSONL";
    ui.btnExportJsonl.addEventListener("click", exportJsonl);

    ui.btnExportCsv = document.createElement("button");
    ui.btnExportCsv.className = "vvLedgerBtn";
    ui.btnExportCsv.type = "button";
    ui.btnExportCsv.textContent = "Export CSV";
    ui.btnExportCsv.addEventListener("click", exportCsv);

    ui.btnRunSuite = document.createElement("button");
    ui.btnRunSuite.className = "vvLedgerBtn";
    ui.btnRunSuite.type = "button";
    ui.btnRunSuite.textContent = "Run suite";
    ui.btnRunSuite.addEventListener("click", runSuite);

    bar.appendChild(ui.btnCopyLast);
    bar.appendChild(ui.btnRuns);
    bar.appendChild(ui.btnRunSuite);
    bar.appendChild(ui.btnExportJsonl);
    bar.appendChild(ui.btnExportCsv);
  }

  function buildRunsPanel() {
    ensureLedgerStyles();
    const panel = document.createElement("div");
    panel.className = "vvLedgerPanel";
    panel.id = "vvLedgerPanel";

    panel.innerHTML = `
      <div class="vvLedgerHeader">
        <div class="title">Run Ledger</div>
        <div class="count" id="vvRunsCount">…</div>
        <div class="spacer"></div>
        <input id="vvRunSearch" placeholder="Search…" />
        <select id="vvRunMode">
          <option value="">All</option>
          <option value="concierge">Concierge</option>
          <option value="experience">Experience</option>
          <option value="booking">Booking</option>
        </select>
        <select id="vvRunCal">
          <option value="">Calendar</option>
          <option value="used">Used</option>
          <option value="not_used">Not used</option>
        </select>
        <select id="vvRunRating">
          <option value="">Rating</option>
          <option value="unrated">Unrated</option>
          <option value="1">★1</option>
          <option value="2">★2</option>
          <option value="3">★3</option>
          <option value="4">★4</option>
          <option value="5">★5</option>
        </select>
        <button class="vvLedgerBtn" id="vvCloseRuns" type="button">Close</button>
      </div>
      <div class="vvLedgerBody">
        <div class="vvLedgerList" id="vvRunsList"></div>
        <div class="vvLedgerDetail" id="vvRunDetail">
          <div style="opacity:.8;font-size:12px;">Select a run to view details.</div>
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    ui.panel = panel;
    ui.list = panel.querySelector("#vvRunsList");
    ui.detail = panel.querySelector("#vvRunDetail");
    ui.search = panel.querySelector("#vvRunSearch");
    ui.filterMode = panel.querySelector("#vvRunMode");
    ui.filterCal = panel.querySelector("#vvRunCal");
    ui.filterRating = panel.querySelector("#vvRunRating");
    ui.runsCount = panel.querySelector("#vvRunsCount");

    panel.querySelector("#vvCloseRuns").addEventListener("click", () => {
      panel.classList.remove("open");
    });

    const rerender = () => renderRunsList();
    ui.search.addEventListener("input", rerender);
    ui.filterMode.addEventListener("change", rerender);
    ui.filterCal.addEventListener("change", rerender);
    ui.filterRating.addEventListener("change", rerender);

    // Suite editor in detail view (top-level access)
    // Stored in localStorage for simplicity (portable via export later)
  }

  function toggleRunsPanel() {
    if (!ui.panel) buildRunsPanel();
    ui.panel.classList.toggle("open");
    if (ui.panel.classList.contains("open")) renderRunsList();
  }

  async function renderRunsList() {
    if (!ui.list) return;

    const query = (ui.search?.value || "").trim().toLowerCase();
    const mode = ui.filterMode?.value || "";
    const cal = ui.filterCal?.value || "";
    const rating = ui.filterRating?.value || "";

    const runs = await dbListRuns(300);
    const filtered = runs.filter((r) => {
      if (mode && r?.derived?.mode !== mode) return false;
      if (cal === "used" && !r?.derived?.calendar_used) return false;
      if (cal === "not_used" && r?.derived?.calendar_used) return false;
      if (rating === "unrated" && (r.rating === 1 || r.rating === 2 || r.rating === 3 || r.rating === 4 || r.rating === 5)) return false;
      if (rating && rating !== "unrated" && String(r.rating || "") !== rating) return false;

      if (!query) return true;
      const hay = `${r.prompt || ""}\n${r.guest_view || ""}\n${r.raw_sse || ""}`.toLowerCase();
      return hay.includes(query);
    });

    const total = await dbCountRuns();
    if (ui.runsCount) ui.runsCount.textContent = `${total} stored`;

    ui.list.innerHTML = filtered
      .map((r) => {
        const badge = r?.derived?.mode || "run";
        const score = (typeof r?.derived?.best_score === "number") ? r.derived.best_score.toFixed(3) : "—";
        const calUsed = r?.derived?.calendar_used ? "cal" : "";
        const stars = r.rating ? ("★".repeat(r.rating) + "☆".repeat(5 - r.rating)) : "unrated";
        return `
          <div class="vvRunRow" data-id="${escapeHtml(r.id)}">
            <div class="vvRunTop">
              <span class="vvBadge">${escapeHtml(badge)}</span>
              ${calUsed ? `<span class="vvBadge">calendar</span>` : ``}
              <span class="vvBadge">score ${escapeHtml(score)}</span>
              <span class="vvTiny">${escapeHtml(r.ts_pt || "")}</span>
            </div>
            <div class="vvPrompt">${escapeHtml((r.prompt || "").slice(0, 140))}</div>
            <div style="margin-top:6px;font-size:11px;opacity:.7;">${escapeHtml(stars)}${r.tag ? ` • ${escapeHtml(r.tag)}` : ""}</div>
          </div>
        `;
      })
      .join("");

    // Click handling
    ui.list.querySelectorAll(".vvRunRow").forEach((row) => {
      row.addEventListener("click", async () => {
        ui.list.querySelectorAll(".vvRunRow").forEach((n) => n.classList.remove("active"));
        row.classList.add("active");
        const id = row.getAttribute("data-id");
        const run = await dbGetRun(id);
        renderRunDetail(run);
      });
    });
  }

  function bundleForChat(run) {
    return {
      ts_pt: run.ts_pt,
      ts_iso: run.ts_iso,
      prompt: run.prompt,
      guest_view: run.guest_view,
      meta: run.meta,
      raw_sse: run.raw_sse,
      derived: run.derived,
      rating: run.rating || null,
      tag: run.tag || null,
      notes: run.notes || null,
    };
  }

  function renderRunDetail(run) {
    if (!ui.detail || !run) return;

    const score = (typeof run?.derived?.best_score === "number") ? run.derived.best_score.toFixed(3) : "—";
    const metaPretty = JSON.stringify(run.meta || {}, null, 2);
    const stars = run.rating ? ("★".repeat(run.rating) + "☆".repeat(5 - run.rating)) : "unrated";

    ui.detail.innerHTML = `
      <div class="vvDetailTitle">Timestamp</div>
      <div class="vvDetailBox">${escapeHtml(run.ts_pt || "")}\n${escapeHtml(run.ts_iso || "")}</div>

      <div class="vvDetailTitle">Prompt</div>
      <div class="vvDetailBox">${escapeHtml(run.prompt || "")}</div>

      <div class="vvDetailTitle">Derived</div>
      <div class="vvDetailBox">mode: ${escapeHtml(run?.derived?.mode || "")}\nscore: ${escapeHtml(score)}\nconfidence: ${escapeHtml(run?.derived?.confidence || "—")}\ncalendar_used: ${escapeHtml(String(!!run?.derived?.calendar_used))}</div>

      <div class="vvDetailTitle">Guest View</div>
      <div class="vvDetailBox">${escapeHtml(run.guest_view || "")}</div>

      <div class="vvDetailTitle">Meta JSON</div>
      <div class="vvDetailBox">${escapeHtml(metaPretty)}</div>

      <div class="vvDetailTitle">Raw SSE</div>
      <div class="vvDetailBox">${escapeHtml(run.raw_sse || "")}</div>

      <div class="vvDetailActions">
        <button type="button" id="vvCopyBundle">Copy bundle</button>
        <button type="button" id="vvLoadToPanes">Load into panes</button>
      </div>

      <div class="vvDetailTitle">Rating / Tag / Notes</div>
      <div class="vvDetailBox">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div><strong>Rating:</strong> <span style="opacity:.85;">${escapeHtml(stars)}</span></div>
          <div class="vvStars" id="vvStars"></div>
          <div style="display:flex;align-items:center;gap:8px;">
            <strong>Tag:</strong>
            <input id="vvTag" value="${escapeHtml(run.tag || "")}" placeholder="e.g., too long / wrong fact / great" />
          </div>
        </div>
        <div style="margin-top:10px;"><textarea class="vvNote" id="vvNotes" placeholder="Notes…">${escapeHtml(run.notes || "")}</textarea></div>
        <div class="vvDetailActions">
          <button type="button" id="vvSaveReview">Save review</button>
        </div>
      </div>

      <div class="vvSuiteWrap">
        <div class="vvDetailTitle">Prompt Test Suite (one per line)</div>
        <textarea id="vvSuiteEditor" placeholder="Add prompts…"></textarea>
        <div class="vvDetailActions">
          <button type="button" id="vvSaveSuite">Save suite</button>
          <button type="button" id="vvRunSuiteNow">Run suite</button>
        </div>
      </div>
    `;

    // Stars buttons
    const starsWrap = ui.detail.querySelector("#vvStars");
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "★" + i;
      b.addEventListener("click", async () => {
        run.rating = i;
        await dbPutRun(run);
        renderRunDetail(run);
        renderRunsList();
      });
      starsWrap.appendChild(b);
    }

    // Copy bundle
    ui.detail.querySelector("#vvCopyBundle").addEventListener("click", async () => {
      const bundle = bundleForChat(run);
      const ok = await copyToClipboard(JSON.stringify(bundle, null, 2));
      setStatus(ok ? "Copied bundle" : "Copy failed");
    });

    // Load to panes
    ui.detail.querySelector("#vvLoadToPanes").addEventListener("click", () => {
      setGuest(run.guest_view || "");
      state.rawLines = String(run.raw_sse || "").split("\n");
      if (els.rawOut) els.rawOut.textContent = state.rawLines.join("\n");
      clearMeta();
      // Rebuild meta cards from meta JSON
      const m = run.meta || {};
      Object.keys(m).forEach((k) => {
        if (k === "live_calendar") return;
        addMetaCard(k, typeof m[k] === "object" ? JSON.stringify(m[k]) : String(m[k]));
      });
      if (m.live_calendar && typeof m.live_calendar.used !== "undefined") {
        addMetaCard("live_calendar.used", String(!!m.live_calendar.used));
        if (m.live_calendar.as_of) addMetaCard("live_calendar.as_of", m.live_calendar.as_of);
        if (m.live_calendar.result) addMetaCard("live_calendar.result", m.live_calendar.result);
      }
      setStatus("Loaded run into panes");
    });

    // Save review (tag/notes)
    ui.detail.querySelector("#vvSaveReview").addEventListener("click", async () => {
      const tag = ui.detail.querySelector("#vvTag")?.value || "";
      const notes = ui.detail.querySelector("#vvNotes")?.value || "";
      run.tag = tag.trim();
      run.notes = notes;
      await dbPutRun(run);
      renderRunsList();
      setStatus("Saved review");
    });

    // Suite editor
    const suiteKey = "vv_ops_suite_v1";
    const suiteText = localStorage.getItem(suiteKey) || DEFAULT_SUITE.join("\n");
    const suiteEditor = ui.detail.querySelector("#vvSuiteEditor");
    suiteEditor.value = suiteText;

    ui.detail.querySelector("#vvSaveSuite").addEventListener("click", () => {
      localStorage.setItem(suiteKey, suiteEditor.value || "");
      setStatus("Saved suite");
    });
    ui.detail.querySelector("#vvRunSuiteNow").addEventListener("click", () => runSuite());
  }

  // -----------------------------
  // Exports
  // -----------------------------
  async function exportJsonl() {
    const runs = await dbListRuns(5000);
    const lines = runs
      .slice()
      .reverse()
      .map((r) => JSON.stringify(bundleForChat(r)));
    const { ts_iso } = ptNowISO();
    const ymd = ts_iso.slice(0, 10);
    downloadText(`vv-agent-runs-${ymd}.jsonl`, lines.join("\n") + "\n");
    setStatus("Exported JSONL");
  }

  async function exportCsv() {
    const runs = await dbListRuns(5000);
    const rows = [
      ["ts_pt", "ts_iso", "mode", "calendar_used", "best_score", "confidence", "rating", "tag", "prompt"].join(","),
    ];
    for (const r of runs.slice().reverse()) {
      const cols = [
        r.ts_pt || "",
        r.ts_iso || "",
        r?.derived?.mode || "",
        String(!!r?.derived?.calendar_used),
        (typeof r?.derived?.best_score === "number") ? String(r.derived.best_score) : "",
        r?.derived?.confidence || "",
        r.rating ? String(r.rating) : "",
        (r.tag || "").replaceAll('"', '""'),
        (r.prompt || "").replaceAll('"', '""'),
      ].map((c) => `"${String(c).replaceAll('"', '""')}"`);
      rows.push(cols.join(","));
    }
    const { ts_iso } = ptNowISO();
    const ymd = ts_iso.slice(0, 10);
    downloadText(`vv-agent-runs-${ymd}.csv`, rows.join("\n") + "\n");
    setStatus("Exported CSV");
  }

  // -----------------------------
  // Prompt Test Suite
  // -----------------------------
  const DEFAULT_SUITE = [
    "Do you have golf carts on property?",
    "Can I walk to the beach from the villa?",
    "How far is the beach from the villa?",
    "Can you arrange a private chef?",
    "Can you set up a private beach day with chairs and drinks?",
    "What about May 13–May 23?",
  ];

  async function runSuite() {
    if (state.running || state.suiteRunning) return;
    const endpoint = normalizeEndpoint(els.endpoint?.value);
    if (!endpoint) {
      setStatus("Missing endpoint URL");
      return;
    }

    const suiteKey = "vv_ops_suite_v1";
    const suiteText = (localStorage.getItem(suiteKey) || DEFAULT_SUITE.join("\n")).trim();
    const prompts = suiteText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);

    if (!prompts.length) {
      setStatus("Suite is empty");
      return;
    }

    state.suiteRunning = true;
    setStatus(`Running suite (${prompts.length})…`);

    const results = [];
    for (let i = 0; i < prompts.length; i++) {
      const p = prompts[i];
      if (els.q) els.q.value = p;

      const r = await runPrompt(p, { suite: true });
      results.push({ prompt: p, ok: !!r, best_score: r?.derived?.best_score ?? null });

      // Small pause to keep UI responsive
      await new Promise((res) => setTimeout(res, 120));
    }

    state.suiteRunning = false;
    setStatus(`Suite complete (${results.length})`);
    // Auto-open runs panel after suite
    try {
      if (!ui.panel) buildRunsPanel();
      ui.panel.classList.add("open");
      await renderRunsList();
    } catch {}
  }

  // -----------------------------
  // Core runner (single prompt)
  // -----------------------------
  async function runPrompt(question, opts = {}) {
    clearAll();

    const endpoint = normalizeEndpoint(els.endpoint?.value);
    const q = (question || "").trim();

    if (!endpoint) {
      setStatus("Missing endpoint URL");
      return null;
    }
    if (!q) {
      setStatus("Missing question");
      return null;
    }

    state.running = true;
    setButtons();
    setStatus("Connecting…");

    state.controller = new AbortController();

    // Prepare run context
    const { ts_iso, ts_pt } = ptNowISO();
    const runId = uuid();
    const run = {
      id: runId,
      ts_iso,
      ts_pt,
      prompt: q,
      guest_view: "",
      meta: {},
      raw_sse: "",
      derived: {},
      rating: null,
      tag: "",
      notes: "",
    };

    return await new Promise(async (resolve) => {
      state.runCtx = { resolve, resolved: false, run };

      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: q }),
          signal: state.controller.signal,
          cache: "no-store",
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          appendRaw(`HTTP ${res.status}`);
          appendRaw(txt || "(no body)");
          setStatus(`Fetch error (HTTP ${res.status})`);
          stop({ keepStatus: true });
          if (!state.runCtx.resolved) {
            state.runCtx.resolved = true;
            resolve(null);
          }
          return;
        }

        const ct = (res.headers.get("content-type") || "").toLowerCase();
        if (!ct.includes("text/event-stream")) {
          const txt = await res.text().catch(() => "");
          appendRaw("Non-SSE response:");
          appendRaw(txt || "(no body)");
          setStatus("Fetch error (not SSE)");
          stop({ keepStatus: true });
          if (!state.runCtx.resolved) {
            state.runCtx.resolved = true;
            resolve(null);
          }
          return;
        }

        setStatus("Streaming…");

        const reader = res.body.getReader();
        const decoder = new TextDecoder("utf-8");

        let textBuf = "";
        let currentEvent = "";
        let currentDataLines = [];

        const flushEvent = async () => {
          if (!currentEvent) return;

          const eventName = currentEvent.trim();
          const dataStr = currentDataLines.join("\n").trim();

          appendRaw(`event: ${eventName}`);
          appendRaw(`data: ${dataStr}`);
          appendRaw("");

          const payload = safeJsonParse(dataStr);

          if (eventName === "start" && payload) {
            clearMeta();
            addMetaCard("request_id", payload.request_id || "");
            addMetaCard("started_at", payload.started_at || "");
            addMetaCard("stay_booking_intent", String(!!payload.stay_booking_intent));
            addMetaCard("experience_intent", String(!!payload.experience_intent));
            if (typeof payload.date_specific !== "undefined") addMetaCard("date_specific", String(!!payload.date_specific));
            if (typeof payload.has_date_range !== "undefined") addMetaCard("has_date_range", String(!!payload.has_date_range));

            // Store meta start fields into run.meta
            run.meta.request_id = payload.request_id || null;
            run.meta.started_at = payload.started_at || null;
            run.meta.stay_booking_intent = !!payload.stay_booking_intent;
            run.meta.experience_intent = !!payload.experience_intent;
            if (typeof payload.date_specific !== "undefined") run.meta.date_specific = !!payload.date_specific;
            if (typeof payload.has_date_range !== "undefined") run.meta.has_date_range = !!payload.has_date_range;
          }

          if (eventName === "token" && payload && typeof payload.text === "string") {
            setGuest((state.guestText || "") + payload.text);
            run.guest_view = (state.guestText || "");
          }

          if (eventName === "cta" && payload) {
            addCTA(payload);
          }

          if (eventName === "meta" && payload) {
            if (typeof payload.confidence !== "undefined") addMetaCard("confidence", payload.confidence);
            if (typeof payload.best_score !== "undefined") addMetaCard("best_score", payload.best_score);
            if (typeof payload.ownership_mode !== "undefined") addMetaCard("ownership_mode", String(!!payload.ownership_mode));
            if (payload.live_calendar && typeof payload.live_calendar.used !== "undefined") {
              addMetaCard("live_calendar.used", String(!!payload.live_calendar.used));
              if (payload.live_calendar.as_of) addMetaCard("live_calendar.as_of", payload.live_calendar.as_of);
              if (payload.live_calendar.result) addMetaCard("live_calendar.result", payload.live_calendar.result);
            }

            // Merge meta payload into run.meta
            run.meta = { ...(run.meta || {}), ...(payload || {}) };
          }

          if (eventName === "error") {
            const msg = payload?.message ? String(payload.message) : "Server error";
            setStatus(`Server error: ${msg}`);
          }

          if (eventName === "done") {
            setStatus("Done");

            // Finalize run record and persist
            run.guest_view = state.guestText || run.guest_view || "";
            run.raw_sse = state.rawLines.join("\n");
            run.derived = derive({ meta: run.meta });

            // Store bundle for ChatGPT copying
            const bundle = bundleForChat(run);
            state.lastRun = { id: run.id, bundle };

            try {
              await dbPutRun(run);
              await dbTrimIfNeeded();
            } catch (e) {
              appendRaw(`Ledger save failed: ${String(e?.message || e)}`);
            }

            // Resolve completion for suite/awaiters
            if (state.runCtx && !state.runCtx.resolved) {
              state.runCtx.resolved = true;
              resolve(run);
            }

            // Stop WITHOUT aborting (avoid false errors)
            stop({ keepStatus: true, noAbort: true });

            // Keep Runs count fresh (if panel open)
            try {
              if (ui.panel && ui.panel.classList.contains("open")) await renderRunsList();
            } catch {}
          }

          currentEvent = "";
          currentDataLines = [];
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          textBuf += decoder.decode(value, { stream: true });

          let lineEnd;
          while ((lineEnd = textBuf.indexOf("\n")) !== -1) {
            let line = textBuf.slice(0, lineEnd);
            textBuf = textBuf.slice(lineEnd + 1);

            if (line.endsWith("\r")) line = line.slice(0, -1);

            if (line === "") {
              await flushEvent();
              continue;
            }

            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
              continue;
            }

            if (line.startsWith("data:")) {
              currentDataLines.push(line.slice(5).trim());
              continue;
            }
          }
        }

        // stream ended without done
        if (state.running) {
          setStatus("Stream ended");
          stop({ keepStatus: true, noAbort: true });
          if (state.runCtx && !state.runCtx.resolved) {
            state.runCtx.resolved = true;
            resolve(null);
          }
        }
      } catch (err) {
        const msg = String(err?.message || err);

        // AbortError is expected when user hits Stop
        if (err?.name === "AbortError" || /abort/i.test(msg)) {
          appendRaw("Aborted");
          setStatus("Stopped");
          stop({ keepStatus: true, noAbort: true });
          if (state.runCtx && !state.runCtx.resolved) {
            state.runCtx.resolved = true;
            resolve(null);
          }
          return;
        }

        appendRaw(`Fetch threw: ${msg}`);
        setStatus("Fetch error");
        stop({ keepStatus: true, noAbort: true });

        if (state.runCtx && !state.runCtx.resolved) {
          state.runCtx.resolved = true;
          resolve(null);
        }
      }
    });
  }

  async function run() {
    const question = (els.q?.value || "").trim();
    await runPrompt(question);
  }

  // -----------------------------
  // Wiring
  // -----------------------------
  function wireUI() {
    if (!els.runBtn || !els.stopBtn || !els.clearBtn) return;

    els.runBtn.addEventListener("click", run);
    els.stopBtn.addEventListener("click", () => stop()); // user intent: show "Stopped"
    els.clearBtn.addEventListener("click", clearAll);

    setButtons();
    setStatus("Idle");

    // Add ledger UI
    insertLedgerButtons();

    // Collapsible raw
    const collapsible = document.querySelector(".collapsible");
    if (collapsible && els.rawOut) {
      collapsible.addEventListener("click", () => {
        els.rawOut.classList.toggle("collapsed");
      });
    }

    // Keyboard shortcut: Cmd/Ctrl + Shift + C => Copy last run
    document.addEventListener("keydown", async (e) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.shiftKey && (e.key === "C" || e.key === "c")) {
        e.preventDefault();
        if (state.lastRun) {
          const ok = await copyToClipboard(JSON.stringify(state.lastRun.bundle, null, 2));
          setStatus(ok ? "Copied last run" : "Copy failed");
        } else {
          setStatus("No runs yet");
        }
      }
    });

    // Prime DB early (avoid first-run delay)
    openDB().catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUI);
  } else {
    wireUI();
  }
})();
