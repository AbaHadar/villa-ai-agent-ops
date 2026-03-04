/*
  OPS SAFE RUN LOGGER
  Non-invasive module that hooks into the existing harness ledger.

  It listens for runs being added and sends them to the Netlify logger
  without modifying the harness core logic.
*/

const LOGGER_ENDPOINT = "/.netlify/functions/log-run";

async function sendRunToLogger(run) {
  try {
    await fetch(LOGGER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(run)
    });
  } catch (err) {
    console.warn("Run logger failed:", err);
  }
}

/*
  Patch the existing addRun function if it exists.
  This avoids touching the original harness file.
*/

(function(){

  if (typeof window.addRun === "function") {

    const originalAddRun = window.addRun;

    window.addRun = function(prompt, guest, meta, raw) {

      const run = {
        timestamp: new Date().toISOString(),
        prompt,
        guest,
        meta,
        raw
      };

      try {
        sendRunToLogger(run);
      } catch(e) {}

      return originalAddRun.apply(this, arguments);
    };

    console.log("Ops run logger attached.");
  }

})();