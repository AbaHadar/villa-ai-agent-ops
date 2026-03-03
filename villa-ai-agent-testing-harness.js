/* villa-ai-agent-testing-harness.js
   Villa Valentín — AI Concierge Ops Console
   SSE test harness (Netlify Functions /ask)
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

  const state = {
    controller: null,
    running: false,
    guestText: "",
    rawLines: [],
  };

  function setStatus(text) {
    if (els.statusText) els.statusText.textContent = text;
  }

  function setButtons() {
    if (!els.runBtn || !els.stopBtn) return;
    els.runBtn.disabled = state.running;
    els.stopBtn.disabled = !state.running;
  }

  function safeJsonParse(line) {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }

  function appendRaw(line) {
    state.rawLines.push(line);
    if (state.rawLines.length > 800) state.rawLines.shift();
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

  function escapeHtml(s) {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeEndpoint(url) {
    const u = (url || "").trim();
    return u.replace(/\/+$/, "");
  }

  function clearAll() {
    setGuest("");
    state.rawLines = [];
    if (els.rawOut) els.rawOut.textContent = "(no events yet)";
    clearMeta();
    clearCTAs();
    setStatus("Idle");
  }

  /**
   * stop({ keepStatus: true }) will NOT overwrite the current status text.
   */
  function stop(opts = {}) {
    if (state.controller) {
      try {
        state.controller.abort();
      } catch {}
    }
    state.controller = null;
    state.running = false;
    setButtons();

    if (!opts.keepStatus) setStatus("Stopped");
  }

  async function run() {
    const endpoint = normalizeEndpoint(els.endpoint?.value);
    const question = (els.q?.value || "").trim();

    clearAll();

    if (!endpoint) {
      setStatus("Missing endpoint URL");
      return;
    }
    if (!question) {
      setStatus("Missing question");
      return;
    }

    state.running = true;
    setButtons();
    setStatus("Connecting…");

    state.controller = new AbortController();

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
        signal: state.controller.signal,
        cache: "no-store",
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        appendRaw(`HTTP ${res.status}`);
        appendRaw(txt || "(no body)");
        setStatus(`Fetch error (HTTP ${res.status})`);
        stop({ keepStatus: true });
        return;
      }

      const ct = (res.headers.get("content-type") || "").toLowerCase();
      if (!ct.includes("text/event-stream")) {
        const txt = await res.text().catch(() => "");
        appendRaw("Non-SSE response:");
        appendRaw(txt || "(no body)");
        setStatus("Fetch error (not SSE)");
        stop({ keepStatus: true });
        return;
      }

      setStatus("Streaming…");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");

      // Robust SSE parsing (handles \n and \r\n)
      let textBuf = "";
      let currentEvent = "";
      let currentDataLines = [];

      const flushEvent = () => {
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
        }

        if (eventName === "token" && payload && typeof payload.text === "string") {
          setGuest((state.guestText || "") + payload.text);
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
        }

        if (eventName === "error") {
          const msg = payload?.message ? String(payload.message) : "Server error";
          setStatus(`Server error: ${msg}`);
        }

        if (eventName === "done") {
          setStatus("Done");
          stop({ keepStatus: true });
        }

        currentEvent = "";
        currentDataLines = [];
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        textBuf += decoder.decode(value, { stream: true });

        // Process complete lines; keep partial line in buffer
        let lineEnd;
        while ((lineEnd = textBuf.indexOf("\n")) !== -1) {
          let line = textBuf.slice(0, lineEnd);
          textBuf = textBuf.slice(lineEnd + 1);

          // Strip trailing CR for \r\n
          if (line.endsWith("\r")) line = line.slice(0, -1);

          // Blank line means dispatch current event
          if (line === "") {
            flushEvent();
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

          // Ignore other SSE fields (id:, retry:, etc.)
        }
      }

      // stream ended without done
      if (state.running) {
        setStatus("Stream ended");
        stop({ keepStatus: true });
      }
    } catch (err) {
      appendRaw(`Fetch threw: ${String(err?.message || err)}`);
      setStatus("Fetch error");
      stop({ keepStatus: true });
    }
  }

  function wireUI() {
    if (!els.runBtn || !els.stopBtn || !els.clearBtn) return;

    els.runBtn.addEventListener("click", run);
    els.stopBtn.addEventListener("click", () => stop()); // user intent: show "Stopped"
    els.clearBtn.addEventListener("click", clearAll);

    setButtons();
    setStatus("Idle");

    const collapsible = document.querySelector(".collapsible");
    if (collapsible && els.rawOut) {
      collapsible.addEventListener("click", () => {
        els.rawOut.classList.toggle("collapsed");
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUI);
  } else {
    wireUI();
  }
})();