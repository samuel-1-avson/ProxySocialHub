// node src/preflightCli.ts [--api-url https://api.proxyhubb.com] [--regions GH,US]

import { loadConfig } from "./config.ts";
import { liveReady, runPreflight, type CheckStatus } from "./preflight.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const mark: Record<CheckStatus, string> = { ok: "[ ok ]", warn: "[warn]", fail: "[FAIL]", skip: "[skip]" };

const config = loadConfig();
const checks = await runPreflight(config, { apiUrl: arg("api-url"), regions: arg("regions")?.split(",").filter(Boolean) ?? ["GH", "US"] });

console.log("ProxyHubb Regional Auditor: live preflight (read-only; nothing is sent to ProxyHubb besides an unauthenticated CONNECT)\n");
for (const c of checks) console.log(`${mark[c.status]} ${c.title}\n       ${c.detail}`);
const ready = liveReady(checks);
console.log(`\n${ready ? "Ready to attempt a live audit." : "NOT ready for a live audit: fix the [FAIL] items above."}`);
console.log("Even when ready, this cannot prove a regional exit works. That is only known after a signed-in audit: sign in through the web UI, choose Live, and the audit verifies each exit.");
process.exit(ready ? 0 : 1);
