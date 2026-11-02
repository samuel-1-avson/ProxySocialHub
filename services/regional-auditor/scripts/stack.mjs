// One command to run the Regional Auditor together with the web app.
//
//   node scripts/stack.mjs fixture --api-url http://localhost:18080
//   node scripts/stack.mjs live --api-url https://api.proxyhubb.com --target https://your-site.example
//
// It generates a fresh shared secret for this run (never printed or written to disk), starts the worker and
// the web dev server with it, and prints what to open. In live mode it runs the preflight first and refuses to
// start when a prerequisite is missing (override with --force). You still sign in yourself, in the browser:
// this script never sees or handles credentials.

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(here, "..");
const webDir = path.resolve(workerDir, "..", "..", "apps", "web");

const args = process.argv.slice(2);
const mode = args[0];
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

if (!["fixture", "live"].includes(mode) || flag("help")) {
  console.log(`Usage:
  node scripts/stack.mjs fixture [--api-url <control API>] [--no-web]
  node scripts/stack.mjs live --api-url <control API> --target <https origin you may audit> [--proxy host:port] [--force] [--no-web]

  fixture   demo site + local fixture proxy (synthetic evidence; development only)
  live      real ProxyHubb sessions; needs you to sign in through the web UI
  --api-url control API the web app signs in against (default http://localhost:18080)
  --target  the HTTPS origin the worker may audit (live)
  --proxy   buyer gateway host:port (default proxy.proxyhubb.com:8090)
  --no-web  start only the worker (you already run the web app with the same secret)
  --force   start live mode even if the preflight reports failures`);
  process.exit(mode ? 0 : 1);
}

const apiUrl = opt("api-url", "http://localhost:18080");
const target = opt("target");
const proxy = opt("proxy", "proxy.proxyhubb.com:8090");
const workerPort = opt("worker-port", "4021");
const secret = randomBytes(32).toString("hex");

if (mode === "live") {
  if (!target) {
    console.error("live mode needs --target https://<origin you are authorized to audit>");
    process.exit(1);
  }
  try {
    if (new URL(target).protocol !== "https:") throw new Error("not https");
  } catch {
    console.error("--target must be an https URL");
    process.exit(1);
  }
}

const workerEnv = {
  ...process.env,
  AUDITOR_SERVICE_SECRET: secret,
  AUDITOR_PORT: workerPort,
  ...(mode === "fixture"
    ? { AUDITOR_FIXTURE_ENABLED: "1" }
    : { AUDITOR_PROXY_ENDPOINT: proxy, AUDITOR_ALLOWED_TARGET_ORIGINS: new URL(target).origin, AUDITOR_FIXTURE_ENABLED: "" }),
};

if (mode === "live") {
  console.log("Running the live preflight first...\n");
  const result = spawnSync(process.execPath, ["src/preflightCli.ts", "--api-url", apiUrl], { cwd: workerDir, env: workerEnv, stdio: "inherit" });
  if (result.status !== 0 && !flag("force")) {
    console.error("\nPreflight failed, so nothing was started. Fix the [FAIL] items, or pass --force to start anyway.");
    process.exit(1);
  }
}

const children = [];
function start(name, command, commandArgs, cwd, env) {
  // Run node directly (its Windows path contains spaces); only npm needs a shell, and it gets a single command string.
  const viaShell = command === "npm";
  const child = viaShell
    ? spawn(`npm ${commandArgs.join(" ")}`, { cwd, env, stdio: ["ignore", "pipe", "pipe"], shell: true })
    : spawn(command, commandArgs, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `[${name}] `;
  for (const stream of [child.stdout, child.stderr]) stream.on("data", (d) => process.stdout.write(String(d).split("\n").filter(Boolean).map((l) => prefix + l).join("\n") + "\n"));
  child.on("exit", (code) => {
    console.log(`${prefix}exited (${code})`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) {
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(c.pid), "/T", "/F"], { stdio: "ignore" });
      else c.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("worker", process.execPath, ["src/server.ts"], workerDir, workerEnv);

const webEnv = {
  ...process.env,
  AUDITOR_SERVICE_SECRET: secret,
  AUDITOR_URL: `http://127.0.0.1:${workerPort}`,
  API_URL: apiUrl,
  NEXT_PUBLIC_API_URL: apiUrl,
  // The Connect page and /api/proxy/test show and use the real gateway in live mode.
  ...(mode === "live" ? { NEXT_PUBLIC_PROXY_ENDPOINT: proxy, PROXYHUBB_PROXY_ENDPOINT: proxy } : {}),
};
if (!flag("no-web")) start("web", "npm", ["run", "dev"], webDir, webEnv);

async function waitFor(url, label, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until && !closing) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error(`${label} did not come up in time.`);
  return false;
}

const workerUp = await waitFor(`http://127.0.0.1:${workerPort}/healthz`, "worker", 30_000);
const webUp = flag("no-web") ? true : await waitFor("http://localhost:4011/login", "web app", 240_000);
if (workerUp && webUp && !closing) {
  console.log(`
==========================================================================
 Regional Auditor is running (${mode} mode)
   worker   http://127.0.0.1:${workerPort}   (internal; the browser never calls it)
   web      http://localhost:4011/app/connections?tab=audits
   sign-in  against ${apiUrl}  ->  do this yourself in the browser
${mode === "live" ? ` target   ${new URL(target).origin}  (the only origin the worker will visit)\n gateway  ${proxy}\n` : " demo     fixture harness; evidence is synthetic and labelled so everywhere\n"} results  services/regional-auditor/.data (job documents; screenshots are private files)
 Ctrl+C stops everything.
==========================================================================`);
}
