/* =========================================================
   ops-brain-inspector.js
   Renders a Brain Inspector panel by parsing SSE debug frames.
   Requires: ask.mjs emits `event: debug` with JSON data incl. stage.
   ========================================================= */
(() => {
  "use strict";

  const IDS = {
    raw: ["raw-view","rawOut","raw","rawSSE","rawView"],
    guest: ["guest-view","guestOut","guestView"],
    meta: ["meta-view","metaOut","metaView","meta"],
  };

  const $ = (id) => document.getElementById(id);
  const pick = (arr) => arr.map($).find(Boolean);

  const getRawEl = () => pick(IDS.raw);
  const getGuestEl = () => pick(IDS.guest);

  function parseSseEvents(rawText) {
    const chunks = rawText.split(/\n\n+/);
    const out = [];
    for (const chunk of chunks) {
      const lines = chunk.split("\n").map(s => s.trimEnd());
      let ev = null;
      let dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) ev = line.slice(6).trim();
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!ev) continue;
      out.push({ event: ev, dataStr: dataLines.join("\n") });
    }
    return out;
  }

  function getLatestDebugByStage(events) {
    const map = Object.create(null);
    for (const e of events) {
      if (e.event !== "debug") continue;
      try {
        const obj = JSON.parse(e.dataStr);
        if (obj && obj.stage) map[obj.stage] = obj;
      } catch (_) {}
    }
    return map;
  }

  function ensurePanel() {
    if ($("vvBrainInspector")) return;

    const anchor =
      document.querySelector("#outputs") ||
      document.querySelector(".outputs") ||
      document.querySelector(".wrap") ||
      document.body;

    const panel = document.createElement("section");
    panel.id = "vvBrainInspector";
    panel.className = "vv-inspector";
    panel.innerHTML = `
      <div class="vv-inspector__head">
        <div>
          <div class="vv-inspector__title">Brain Inspector</div>
          <div class="vv-inspector__sub">intent → retrieval → prompt → output</div>
        </div>
        <div class="vv-inspector__actions">
          <button class="vv-btn vv-btn--ghost" id="vvInspectorRefresh" type="button">Refresh</button>
          <button class="vv-btn vv-btn--ghost" id="vvInspectorCopy" type="button">Copy debug JSON</button>
        </div>
      </div>

      <div class="vv-inspector__grid">
        <div class="vv-card">
          <div class="vv-card__title">Intent detection</div>
          <pre class="vv-pre" id="vvIntentPre">—</pre>
        </div>

        <div class="vv-card">
          <div class="vv-card__title">Knowledge retrieval</div>
          <pre class="vv-pre" id="vvRetrievalPre">—</pre>
        </div>

        <div class="vv-card vv-card--span2">
          <div class="vv-card__title">Prompt assembly</div>
          <pre class="vv-pre" id="vvPromptPre">—</pre>
        </div>

        <div class="vv-card vv-card--span2">
          <div class="vv-card__title">Model output (Guest View)</div>
          <pre class="vv-pre" id="vvOutputPre">—</pre>
        </div>
      </div>
    `;

    anchor.appendChild(panel);

    $("vvInspectorRefresh")?.addEventListener("click", update);
    $("vvInspectorCopy")?.addEventListener("click", () => {
      try {
        const debugBlob = window.__vv_last_debug_blob || null;
        if (!debugBlob) return;
        navigator.clipboard.writeText(JSON.stringify(debugBlob, null, 2));
      } catch (_) {}
    });
  }

  function update() {
    const rawEl = getRawEl();
    ensurePanel();

    const intentPre = $("vvIntentPre");
    const retrievalPre = $("vvRetrievalPre");
    const promptPre = $("vvPromptPre");
    const outputPre = $("vvOutputPre");

    if (!rawEl) return;

    const raw = rawEl.textContent || "";
    const events = parseSseEvents(raw);
    const byStage = getLatestDebugByStage(events);

    window.__vv_last_debug_blob = byStage;

    if (intentPre) intentPre.textContent = byStage.intent_detection ? JSON.stringify(byStage.intent_detection, null, 2) : "—";
    if (retrievalPre) retrievalPre.textContent = byStage.knowledge_retrieval ? JSON.stringify(byStage.knowledge_retrieval, null, 2) : "—";
    if (promptPre) promptPre.textContent = byStage.prompt_assembly ? JSON.stringify(byStage.prompt_assembly, null, 2) : "—";

    const guestEl = getGuestEl();
    const guestText = (guestEl?.textContent || "").trim();
    if (outputPre) outputPre.textContent = guestText || "—";
  }

  function boot() {
    const rawEl = getRawEl();
    if (!rawEl) return void setTimeout(boot, 400);

    ensurePanel();
    update();

    const obs = new MutationObserver(() => update());
    obs.observe(rawEl, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();