/* =========================================================
   ops-debug-injector.js (ROBUST)
   Forces { debug: true } into POST JSON body for the ask function.
   Works whether the code calls fetch(url, init) or fetch(Request).
   Load this BEFORE villa-ai-agent-testing-harness.js
   ========================================================= */
(() => {
  "use strict";

  const ASK_MATCH = "/.netlify/functions/ask";
  const originalFetch = window.fetch.bind(window);

  const ensureJsonHeader = (headers) => {
    try {
      if (!headers) return new Headers({ "Content-Type": "application/json" });
      if (headers instanceof Headers) {
        const ct = headers.get("content-type") || headers.get("Content-Type");
        if (!ct) headers.set("Content-Type", "application/json");
        return headers;
      }
      const ct = headers["content-type"] || headers["Content-Type"];
      if (!ct) return { ...headers, "Content-Type": "application/json" };
      return headers;
    } catch (_) {
      return headers;
    }
  };

  const injectDebug = (bodyStr) => {
    try {
      const obj = JSON.parse(bodyStr);
      if (obj && typeof obj === "object" && !("debug" in obj)) {
        obj.debug = true;
        return JSON.stringify(obj);
      }
    } catch (_) {}
    return bodyStr;
  };

  window.fetch = async (input, init = {}) => {
    try {
      // fetch(url, init)
      if (typeof input === "string") {
        if (input.includes(ASK_MATCH)) {
          const method = String(init.method || "GET").toUpperCase();
          if (method === "POST" && typeof init.body === "string") {
            return originalFetch(input, {
              ...init,
              headers: ensureJsonHeader(init.headers),
              body: injectDebug(init.body),
            });
          }
        }
        return originalFetch(input, init);
      }

      // fetch(Request)
      if (input instanceof Request) {
        const url = input.url || "";
        if (url.includes(ASK_MATCH)) {
          const method = String(input.method || "GET").toUpperCase();
          if (method === "POST") {
            const clone = input.clone();
            const bodyText = await clone.text();

            const headers = new Headers(input.headers);
            const ct = headers.get("content-type") || headers.get("Content-Type") || "";
            const isJson = ct.includes("application/json") || bodyText.trim().startsWith("{");

            if (isJson && bodyText) {
              if (!ct.includes("application/json")) headers.set("Content-Type", "application/json");
              const newBody = injectDebug(bodyText);

              const reqInit = {
                method: input.method,
                headers,
                body: newBody,
                mode: input.mode,
                credentials: input.credentials,
                cache: input.cache,
                redirect: input.redirect,
                referrer: input.referrer,
                referrerPolicy: input.referrerPolicy,
                integrity: input.integrity,
                keepalive: input.keepalive,
                signal: input.signal,
              };

              return originalFetch(new Request(input.url, reqInit));
            }
          }
        }
        return originalFetch(input, init);
      }
    } catch (_) {}

    return originalFetch(input, init);
  };

  try { console.log("[ops-debug-injector] debug=true injection enabled"); } catch (_) {}
})();