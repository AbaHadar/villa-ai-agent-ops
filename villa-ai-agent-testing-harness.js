/* =========================================================
   VILLA AI AGENT OPS HARNESS
   Adds:
   - Run ledger (history)
   - Copy Last Run
   - Export JSONL
   - Export CSV
   - Persistent run logging via Netlify function
   ========================================================= */

const API_ENDPOINT = "/.netlify/functions/ask";
const LOGGER_ENDPOINT = "/.netlify/functions/log-run";

let runLedger = [];

const promptInput = document.getElementById("prompt");
const runBtn = document.getElementById("run");
const clearBtn = document.getElementById("clear");

const guestView = document.getElementById("guest-view");
const metaView = document.getElementById("meta-view");
const rawView = document.getElementById("raw-view");

function nowISO() {
  return new Date().toISOString();
}

async function sendToLogger(data){
  try {
    await fetch(LOGGER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
  } catch(e) {
    console.warn("logger failed", e);
  }
}

function addRun(prompt, guest, meta, raw) {

  const run = {
    timestamp: nowISO(),
    prompt,
    guest,
    meta,
    raw
  };

  runLedger.push(run);

  // send to persistent logger
  sendToLogger(run);
}

function copyLastRun() {

  if (!runLedger.length) return;

  const r = runLedger[runLedger.length - 1];

  const bundle =
`PROMPT:
${r.prompt}

GUEST VIEW:
${r.guest}

META:
${JSON.stringify(r.meta, null, 2)}

RAW SSE:
${r.raw}
`;

  navigator.clipboard.writeText(bundle);
  alert("Copied last run.");
}

function exportJSONL() {

  const lines = runLedger.map(r => JSON.stringify(r)).join("\n");

  const blob = new Blob([lines], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "runs.jsonl";
  a.click();
}

function exportCSV() {

  const header = "timestamp,prompt,guest\n";

  const rows = runLedger.map(r => {
    return `"${r.timestamp}","${r.prompt.replace(/"/g,'""')}","${r.guest.replace(/"/g,'""')}"`;
  });

  const blob = new Blob([header + rows.join("\n")], { type: "text/csv" });

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "runs.csv";
  a.click();
}

async function runPrompt() {

  const prompt = promptInput.value;

  guestView.textContent = "";
  metaView.textContent = "";
  rawView.textContent = "";

  const res = await fetch(API_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: prompt })
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let raw = "";
  let guest = "";
  let meta = {};

  while (true) {

    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    raw += chunk;

    const lines = chunk.split("\n");

    for (const line of lines) {

      if (line.startsWith("data:")) {

        try {

          const obj = JSON.parse(line.replace("data:", ""));

          if (obj.type === "token") {
            guest += obj.text;
            guestView.textContent = guest;
          }

          if (obj.type === "meta") {
            meta = obj.meta;
            metaView.textContent = JSON.stringify(meta, null, 2);
          }

        } catch {}

      }

    }

  }

  rawView.textContent = raw;

  addRun(prompt, guest, meta, raw);
}

runBtn.onclick = runPrompt;

clearBtn.onclick = () => {
  guestView.textContent = "";
  metaView.textContent = "";
  rawView.textContent = "";
};

window.copyLastRun = copyLastRun;
window.exportJSONL = exportJSONL;
window.exportCSV = exportCSV;