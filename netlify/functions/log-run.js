import fs from "fs";
import path from "path";

export async function handler(event) {

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: "Method Not Allowed"
    };
  }

  const data = JSON.parse(event.body);

  const ledgerDir = "/tmp";
  const file = path.join(ledgerDir, "ops-run-ledger.jsonl");

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...data
  }) + "\n";

  fs.appendFileSync(file, line);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
}