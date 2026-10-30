// End to end: drives the real app window over the DevTools protocol, with the real bundled
// provider-node, against a real control-api and database.
//
//   1. Build:   npm run build:sidecar -- --debug && npx tauri build --debug --no-bundle
//   2. Serve:   the control-api pairing handlers on a loopback port (the Go test harness
//               TestZZPairingManualE2E pattern in services/control-api), printing OWNER_ID
//   3. Run:     E2E_OWNER_ID=<id> E2E_API=http://127.0.0.1:18099 node e2e/run.mjs
//
// No dependencies: Node's built-in fetch and WebSocket. Everything the app and the node write
// goes to e2e/artifacts/work (PROXYHUB_CONFIG, PROXYHUB_STATE_DIR, PROXYHUB_APP_DIR, WebView2 profile), never
// to a real profile. The driver refuses to run against anything but a loopback API, or while a
// real node could be running (the node's metrics port is not configurable).

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const E = process.env;
const APP_EXE = E.APP_EXE ?? join(appDir, 'src-tauri', 'target', 'debug', 'proxyhubb-provider-app.exe');
const API = E.E2E_API ?? 'http://127.0.0.1:18099';
const OWNER = E.E2E_OWNER_ID;
// Run one scenario that needs no control-api (E2E_ONLY=resume-pause); unset runs them all.
const ONLY = E.E2E_ONLY ?? '';
const CDP_PORT = Number(E.CDP_PORT ?? 9444);
const OUT = resolve(E.E2E_OUT ?? join(here, 'artifacts'));
const METRICS_PORT = 9090; // provider-node's default; not configurable, so it must be free

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  return ok;
}
async function until(fn, label, ms = 30000, step = 400) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(step);
  }
  throw new Error(`timed out after ${ms} ms waiting for ${label}${last instanceof Error ? `: ${last.message}` : ''}`);
}

// ── guards: never touch anything real ────────────────────────────────────────

function preflight() {
  if (!OWNER && !ONLY) throw new Error('set E2E_OWNER_ID (printed by the control-api harness)');
  const host = new URL(API).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error(`E2E_API must be a loopback address, got ${host}`);
  if (!existsSync(APP_EXE)) throw new Error(`app executable not found: ${APP_EXE}`);
}

function portInUse(port) {
  return new Promise((res) => {
    const s = net.connect({ port, host: '127.0.0.1' }, () => { s.destroy(); res(true); });
    s.on('error', () => res(false));
  });
}

function pidAlive(pid) {
  const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' });
  return new RegExp(`\\b${pid}\\b`).test(r.stdout ?? '');
}

function appRunning() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq proxyhubb-provider-app.exe', '/NH'], { encoding: 'utf8' });
  return /proxyhubb-provider-app/i.test(r.stdout ?? '');
}

// Asks Windows about the "ProxyHubb Provider" window: 'visible', 'hidden' (exists, not shown) or 'none'.
function windowState(pid) {
  const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'window-state.ps1'), '-ProcessId', String(pid)], { encoding: 'utf8' });
  return (r.stdout ?? '').trim() || 'none';
}
const windowVisible = (pid) => windowState(pid) === 'visible';

function appInstanceCount() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq proxyhubb-provider-app.exe', '/NH'], { encoding: 'utf8' });
  return (r.stdout ?? '').split(String.fromCharCode(10)).filter((l) => /proxyhubb-provider-app/i.test(l)).length;
}

function anyProviderNode() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq provider-node.exe', '/NH'], { encoding: 'utf8' });
  return /provider-node\.exe/i.test(r.stdout ?? '');
}

// ── a minimal DevTools-protocol client ───────────────────────────────────────

async function connect() {
  const page = await until(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    return pages.find((p) => p.type === 'page');
  }, 'the app window (DevTools target)', 30000, 500);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('websocket error')); });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) pending.get(d.id)(d); };
  const call = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
  return {
    evaluate,
    text: () => evaluate('document.body.innerText'),
    html: () => evaluate('document.body.innerHTML'),
    close: () => ws.close(),
    async shot(name) {
      const img = await call('Page.captureScreenshot', { format: 'png' });
      writeFileSync(join(OUT, `${name}.png`), Buffer.from(img.result.data, 'base64'));
    },
    // Click the button whose visible text is exactly `label`. Returns false if absent or disabled.
    clickButton: (label) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); if (!b || b.disabled) return false; b.click(); return true; })()`),
    buttonState: (label) => evaluate(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim() === ${JSON.stringify(label)}); return b ? (b.disabled ? 'disabled' : 'enabled') : 'absent'; })()`),
    // Click the checkbox inside the label containing `snippet`.
    tick: (snippet) => evaluate(`(() => { const l = [...document.querySelectorAll('label')].find(x => x.textContent.includes(${JSON.stringify(snippet)})); const i = l && l.querySelector('input'); if (!i) return false; i.click(); return true; })()`),
  };
}

// ── one isolated app instance ────────────────────────────────────────────────

// Every app this run starts, so the end can stop exactly those and never someone's real app.
const spawnedApps = new Set();

async function launch(label, args = [], seed = undefined) {
  const work = join(OUT, 'work', label);
  rmSync(work, { recursive: true, force: true });
  for (const d of ['app', 'state', 'webview2']) mkdirSync(join(work, d), { recursive: true });
  if (seed) seed(work);
  const env = {
    ...process.env,
    // Explicit overrides, not a redirected profile: WebView2 and the Windows folder APIs ignore
    // or break on a redirected APPDATA/USERPROFILE.
    PROXYHUB_CONFIG: join(work, 'provider.toml'),
    PROXYHUB_STATE_DIR: join(work, 'state'),
    PROXYHUB_APP_DIR: join(work, 'app'),
    WEBVIEW2_USER_DATA_FOLDER: join(work, 'webview2'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    PROXYHUB_API_URL: API,
    PROXYHUB_GATEWAY_ADDR: '127.0.0.1:3128', // nothing listens: the node will sit in "connecting"
  };
  const logFd = openSync(join(work, 'app.log'), 'a');
  const child = spawn(APP_EXE, args, { env, stdio: ['ignore', logFd, logFd], windowsHide: false });
  spawnedApps.add(child.pid);
  const page = await connect();
  const files = {
    config: join(work, 'provider.toml'),
    settings: join(work, 'app', 'settings.json'),
    pid: join(work, 'state', 'provider.pid'),
  };
  const readPid = () => { try { return Number(readFileSync(files.pid, 'utf8').trim()) || 0; } catch { return 0; } };
  const settings = () => { try { return JSON.parse(readFileSync(files.settings, 'utf8')); } catch { return null; } };
  const stop = async () => {
    page.close();
    const pid = readPid();
    if (pid) spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
    spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)], { stdio: 'ignore' });
    // The next launch must not start while this instance (the single-instance lock) or its
    // DevTools port still exists.
    await until(async () => !appRunning() && !(await portInUse(CDP_PORT)), 'the previous app to exit', 20000, 500);
    try { closeSync(logFd); } catch {}
  };
  return { child, page, files, readPid, settings, stop, work, env };
}

// ── owner side: the dashboard's two calls ────────────────────────────────────

const ownerHeaders = { 'X-Test-User': OWNER, 'X-Test-Role': 'provider', 'Content-Type': 'application/json' };
const lookup = async (code) => (await fetch(`${API}/v1/provider/pair/lookup?code=${code}`, { headers: ownerHeaders })).json();
const decide = async (code, decision) => (await fetch(`${API}/v1/provider/pair/decision`, { method: 'POST', headers: ownerHeaders, body: JSON.stringify({ code, decision }) })).json();

const CODE_RE = /^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;
const codeOnScreen = (page) => page.evaluate(`document.querySelector('.code')?.textContent?.trim() ?? ''`);

// ── scenarios ────────────────────────────────────────────────────────────────

async function happyPath() {
  console.log('\n— Scenario 1: first run, consent, pairing, pause, resume, close to tray');
  const app = await launch('happy');
  const { page } = app;
  try {
    await until(async () => (await page.text()).includes('Before you start sharing'), 'the consent screen');
    check('first launch shows the consent screen', true);
    check('the window is visible on a normal launch', windowVisible(app.child.pid));
    check('nothing is recorded before they agree', app.settings() === null);
    check('the continue button is off until the box is ticked', (await page.buttonState('I understand, continue')) === 'disabled');
    await page.shot('01-consent');

    await page.tick('I own this internet connection');
    await until(async () => (await page.buttonState('I understand, continue')) === 'enabled', 'the button to enable');
    await page.clickButton('I understand, continue');
    await until(async () => (await page.text()).includes('Connect this computer'), 'the Connect screen');
    check('consent moves on to the Connect screen', true);
    await until(() => app.settings()?.consent?.version === 1, 'consent to be saved');
    check('consent (version 1) is saved in the isolated settings folder', true);
    check('sharing is still not wanted', app.settings().sharing_wanted === false);

    await page.clickButton('Connect');
    await until(async () => CODE_RE.test(await codeOnScreen(page)), 'a pairing code on screen', 20000);
    const code = await codeOnScreen(page);
    check('a pairing code appears', true, code);
    await page.shot('02-code');

    const info = await lookup(code);
    check('the dashboard sees this computer: name, system, version', Boolean(info.device_name) && info.platform === 'windows' && Boolean(info.client_version), `${info.device_name} / ${info.platform}`);
    check('no config exists yet', !existsSync(app.files.config));
    const res = await decide(code, 'approve');
    check('the owner approves the code', res.status === 'approved');

    await until(async () => !(await page.text()).includes('Approve this code'), 'the app to leave the code screen', 40000, 800);
    await until(() => existsSync(app.files.config), 'provider.toml to be written', 20000);
    check('provider.toml is written to the pinned path', true);
    const toml = readFileSync(app.files.config, 'utf8');
    check('the config points at the harness, not production', toml.includes(API) && !toml.includes('proxyhubb.com'));
    await until(() => app.settings()?.sharing_wanted === true, 'the sharing wish to be saved');
    check('approval remembers the wish to share', true);

    const pid = await until(() => app.readPid(), 'the node PID file', 30000);
    await until(() => pidAlive(pid), 'the node process', 15000);
    check('the node is running, started by the app', true, `pid ${pid}`);
    const body = await until(async () => { const t = await page.text(); return /Connecting|Sharing is on/.test(t) ? t : ''; }, 'the Connecting/Sharing screen', 30000);
    check('the window shows the node coming up', true, /Connecting/.test(body) ? 'connecting (no gateway in this harness)' : 'sharing');
    await page.shot('03-running');

    // Pause and resume, from the screen a person with a struggling node actually sees.
    check('there is a Pause button while connecting', (await page.buttonState('Pause sharing')) === 'enabled');
    await page.clickButton('Pause sharing');
    await until(async () => (await page.text()).includes('Sharing is paused'), 'the paused screen');
    await until(() => !pidAlive(pid), 'the node to stop', 15000);
    check('Pause stops the node', true);
    check('Pause is remembered', app.settings().sharing_wanted === false);
    await page.shot('04-paused');
    await page.clickButton('Resume sharing');
    await until(async () => /Connecting|Sharing is on/.test(await page.text()), 'the node to come back');
    const pid2 = await until(() => { const p = app.readPid(); return p && pidAlive(p) ? p : 0; }, 'the node to run again', 20000);
    check('Resume starts the node again', true, `pid ${pid2}`);

    // Closing the window hides it; the app and the node keep going.
    spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${app.child.pid}).CloseMainWindow() | Out-Null`]);
    await sleep(2500);
    check('closing the window leaves the app running (in the tray)', pidAlive(app.child.pid));
    check('and the window is no longer visible', windowState(app.child.pid) === 'hidden', windowState(app.child.pid));
    check('and the node keeps running', pidAlive(app.readPid()));
  } finally {
    await app.stop();
  }
}

async function deniedPath() {
  console.log('\n— Scenario 2: the owner denies the code');
  const app = await launch('denied');
  const { page } = app;
  try {
    await until(async () => (await page.text()).includes('Before you start sharing'), 'the consent screen');
    await page.tick('I own this internet connection');
    await page.clickButton('I understand, continue');
    await until(async () => (await page.text()).includes('Connect this computer'), 'the Connect screen');
    await page.clickButton('Connect');
    await until(async () => CODE_RE.test(await codeOnScreen(page)), 'a pairing code', 20000);
    const code = await codeOnScreen(page);
    check('a code appears', true, code);
    const res = await decide(code, 'deny');
    check('the owner denies it', res.status === 'denied');
    await until(async () => (await page.text()).includes('The request was denied'), 'the denied notice', 30000, 800);
    check('the window says the request was denied', true);
    check('the Connect button is back', (await page.buttonState('Connect')) === 'enabled');
    check('no config was written', !existsSync(app.files.config));
    check('sharing was not turned on', app.settings().sharing_wanted === false);
    check('no node was started', app.readPid() === 0 || !pidAlive(app.readPid()));
    await page.shot('05-denied');
  } finally {
    await app.stop();
  }
}

async function cancelPath() {
  console.log('\n— Scenario 3: the person cancels while a code is showing');
  const app = await launch('cancel');
  const { page } = app;
  try {
    await until(async () => (await page.text()).includes('Before you start sharing'), 'the consent screen');
    await page.tick('I own this internet connection');
    await page.clickButton('I understand, continue');
    await until(async () => (await page.text()).includes('Connect this computer'), 'the Connect screen');
    await page.clickButton('Connect');
    await until(async () => CODE_RE.test(await codeOnScreen(page)), 'a pairing code', 20000);
    const code = await codeOnScreen(page);
    await page.clickButton('Cancel');
    await until(async () => (await page.text()).includes('Connect this computer'), 'back at the Connect screen');
    check('Cancel returns to the Connect screen', true);
    const res = await decide(code, 'approve');
    // The code may still be approvable on the server (the app only stops waiting), but nothing
    // may reach this computer: no config, no node.
    await sleep(8000);
    check('an approval after Cancel changes nothing on this computer', !existsSync(app.files.config) && app.readPid() === 0, `server said ${res.status ?? res.code}`);
  } finally {
    await app.stop();
  }
}

async function hiddenAndSingleInstance() {
  console.log(''); console.log('— Scenario 4: start hidden (as at sign-in), then a second launch');
  const app = await launch('hidden', ['--hidden']);
  try {
    await sleep(3000);
    check('--hidden starts the app with its window hidden, not shown', pidAlive(app.child.pid) && windowState(app.child.pid) === 'hidden', windowState(app.child.pid));
    check('--hidden shows nothing and records nothing', app.settings() === null);

    // A second launch must not start another copy; it brings the first one forward.
    const second = spawn(APP_EXE, [], { env: app.env, stdio: 'ignore' });
    await until(() => !pidAlive(second.pid), 'the second launch to exit', 15000, 300);
    check('a second launch exits instead of starting another copy', true);
    check('exactly one app instance is running', appInstanceCount() === 1, `${appInstanceCount()} running`);
    await until(() => windowVisible(app.child.pid), 'the first window to be brought forward', 8000, 300);
    check('the second launch brings the first window forward', true);
  } finally {
    await app.stop();
  }
}

// An app that was installed, consented and paired earlier and is now paused: the scenario can
// start from the Resume button. The node it will start is isolated and sits in "connecting"
// (nothing listens on the loopback gateway), which is exactly the node that was hard to stop.
function seedPausedAndPaired(work) {
  const nl = String.fromCharCode(10);
  writeFileSync(join(work, 'app', 'settings.json'), JSON.stringify({ consent: { version: 1, accepted_at_unix: 1 }, sharing_wanted: false }));
  writeFileSync(join(work, 'provider.toml'), [
    'api_key = "e2e-not-a-real-key"',
    `control_api_url = "${API}"`,
    'gateway_addr = "127.0.0.1:3128"',
    'node_id = "e2e-seeded-node"',
    '',
  ].join(nl));
}

async function resumeThenPause() {
  console.log(''); console.log('— Scenario 5: resume a node that cannot reach its gateway, then pause it');
  const app = await launch('resume-pause', [], seedPausedAndPaired);
  const { page } = app;
  try {
    await until(async () => (await page.text()).includes('Sharing is paused'), 'the paused screen');
    check('a consented, paired, paused app offers Resume', (await page.buttonState('Resume sharing')) === 'enabled');
    await page.clickButton('Resume sharing');
    const pid = await until(() => { const p = app.readPid(); return p && pidAlive(p) ? p : 0; }, 'the node to run', 25000);
    check('Resume starts the node', true, `pid ${pid}`);
    await until(async () => /Connecting|Sharing is on/.test(await page.text()), 'the Connecting screen', 20000);

    // The regression. Resume waited for the node to EXIT: the background node kept the pipe the
    // app was reading open, so the page stayed busy and Pause was greyed out for as long as the
    // node ran. A person whose node cannot connect must still be able to stop it.
    const usable = await until(async () => (await page.buttonState('Pause sharing')) === 'enabled', 'Pause to be usable after Resume', 15000).then(() => true, () => false);
    check('Pause is usable after Resume (the page is not stuck busy)', usable);
    await page.shot('06-resumed');
    if (!usable) return;

    await page.clickButton('Pause sharing');
    await until(async () => (await page.text()).includes('Sharing is paused'), 'the paused screen after Pause', 20000);
    await until(() => !pidAlive(pid), 'the node to stop', 15000);
    check('Pause stops the node', true);
    check('Pause is remembered', app.settings().sharing_wanted === false);
    check('and Resume is offered again', (await page.buttonState('Resume sharing')) === 'enabled');
    await sleep(7000); // longer than the supervisor's pass: nothing may bring the node back
    check('the node stays stopped', app.readPid() === 0 || !pidAlive(app.readPid()));
  } finally {
    await app.stop();
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true });
let failed = true;
try {
  preflight();
  // This run starts its own isolated apps and, when it ends, stops only those. A real app that
  // is already open would also hold the single-instance lock and the node's metrics port.
  if (appRunning()) throw new Error('a ProxyHubb Provider app is already running; close it (tray, Quit) first. Refusing to run');
  if (await portInUse(METRICS_PORT)) throw new Error(`port ${METRICS_PORT} is in use: a real node may be running; refusing to run`);
  if (anyProviderNode()) throw new Error('a provider-node.exe is already running; refusing to run');
  if (!ONLY) {
    await happyPath();
    await deniedPath();
    await cancelPath();
    await hiddenAndSingleInstance();
  }
  if (!ONLY || ONLY === 'resume-pause') await resumeThenPause();
  failed = results.some((r) => !r.ok);
} catch (e) {
  console.log(`\nFAIL  ${e.message}`);
} finally {
  for (const pid of spawnedApps) spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
