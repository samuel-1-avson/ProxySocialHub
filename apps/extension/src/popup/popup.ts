import { BROWSER_NAME, IS_FIREFOX, getApiBase, setApiBase } from '../lib/config';
import { getSignedInLabel, loadBootstrap, pairFinish, type Bootstrap } from '../lib/auth';
import type { ConnectStatus } from '../lib/connect';
import { switchAction, switchButtonLabel } from '../lib/reliability';

const headlineEl = document.getElementById('headline') as HTMLHeadingElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;
const proxyEl = document.getElementById('proxy-control') as HTMLParagraphElement;
const errorEl = document.getElementById('error') as HTMLParagraphElement;
const codeEl = document.getElementById('code') as HTMLInputElement;
const apiEl = document.getElementById('api-base') as HTMLInputElement;
const pairBtn = document.getElementById('pair') as HTMLButtonElement;
const saveApiBtn = document.getElementById('save-api') as HTMLButtonElement;
const connectPanel = document.getElementById('connect-panel') as HTMLElement;
const orderEl = document.getElementById('order') as HTMLSelectElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;
const verifyEl = document.getElementById('verify') as HTMLParagraphElement;
const recheckBtn = document.getElementById('recheck') as HTMLButtonElement;
const expiryEl = document.getElementById('expiry') as HTMLParagraphElement;
const switchNoteEl = document.getElementById('switch-note') as HTMLParagraphElement;
const incognitoEl = document.getElementById('incognito') as HTMLParagraphElement;
const pairPanel = document.getElementById('pair-panel') as HTMLElement;

let lastStatus: ConnectStatus = { state: 'off' };
let lastLevel = '';
let otherExtensionControls = false;

function showError(message: string) {
  errorEl.hidden = !message;
  errorEl.textContent = message;
}

function sendWorker<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: T & { ok?: boolean; error?: string }) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.ok === false) {
        reject(new Error(response.error || 'request failed'));
        return;
      }
      resolve(response);
    });
  });
}

function updateConnectButton() {
  const selected = orderEl.value;
  const action = switchAction(lastStatus.state, lastStatus.orderId, selected);
  connectBtn.textContent = switchButtonLabel(action);
  connectBtn.disabled = otherExtensionControls || !selected || action === 'same';
  switchNoteEl.hidden = action !== 'switch';
}

function fillOrders(boot: Bootstrap, selectedId?: string) {
  const ready = boot.orders.filter((o) => o.credentials_ready);
  orderEl.replaceChildren();
  if (ready.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No active proxies yet';
    orderEl.append(opt);
    updateConnectButton();
    return;
  }
  for (const order of ready) {
    const opt = document.createElement('option');
    opt.value = order.id;
    opt.textContent = order.listing_title || order.id.slice(0, 8);
    orderEl.append(opt);
  }
  if (selectedId && ready.some((o) => o.id === selectedId)) {
    orderEl.value = selectedId;
  }
  updateConnectButton();
}

function describeState(status: ConnectStatus, level: string) {
  if (status.state === 'on' && level === 'controlled_by_this_extension') {
    headlineEl.textContent = 'Proxy is on';
    return status.listingTitle ? `Using ${status.listingTitle}` : '';
  }
  if (status.state === 'lost') {
    headlineEl.textContent = 'Connection dropped';
    return 'Turn it off, then on again.';
  }
  headlineEl.textContent = 'Proxy is off';
  if (level === 'controlled_by_other_extensions') {
    return `Another extension is controlling ${BROWSER_NAME}'s proxy. Turn that one off first.`;
  }
  return '';
}

/** Turns worker error text into something a buyer can act on. */
function friendlyError(raw: string): string {
  if (/no egress IP|verify failed/i.test(raw)) {
    return "Couldn't reach the internet through the proxy. Check that the order is still active, then try again.";
  }
  if (/another extension/i.test(raw)) {
    return `Another extension is controlling ${BROWSER_NAME}'s proxy. Turn that one off first.`;
  }
  if (/failed to fetch|networkerror/i.test(raw)) {
    return "Can't reach ProxyHubb right now. Check your internet and try again.";
  }
  return raw;
}

function renderExpiry(status: ConnectStatus) {
  expiryEl.textContent = status.expiryMessage || '';
}

function renderVerify(status: ConnectStatus) {
  const snapshot = status.verify;
  verifyEl.classList.remove('ok', 'bad');
  if (!snapshot) {
    verifyEl.textContent = '';
    return;
  }
  const rtt = typeof snapshot.rttMs === 'number' ? `${snapshot.rttMs}ms` : null;
  if (status.state === 'on' && snapshot.healthy && snapshot.ip) {
    verifyEl.classList.add('ok');
    const hairpin = snapshot.hairpin ? '(same network as the provider)' : null;
    verifyEl.textContent = [`Your IP now: ${snapshot.ip}`, rtt, hairpin].filter(Boolean).join(' · ');
    return;
  }
  if (snapshot.error) {
    verifyEl.classList.add('bad');
    verifyEl.textContent = friendlyError(snapshot.error);
    return;
  }
  if (snapshot.ip) {
    verifyEl.textContent = `Your IP: ${snapshot.ip}`;
    return;
  }
  verifyEl.textContent = '';
}

async function renderIncognitoNote() {
  const howTo = IS_FIREFOX
    ? 'To use it in private windows, allow ProxyHubb in private windows in Firefox add-on settings.'
    : 'To use it in Incognito, turn on "Allow in Incognito" for ProxyHubb on chrome://extensions.';
  if (!chrome.extension?.isAllowedIncognitoAccess) {
    incognitoEl.textContent = howTo;
    return;
  }
  const allowed = await chrome.extension.isAllowedIncognitoAccess();
  incognitoEl.textContent = allowed ? '' : howTo;
}

async function refreshStatus() {
  const label = await getSignedInLabel();
  const worker = await sendWorker<{
    status: ConnectStatus;
    levelOfControl: string;
  }>({ type: 'status' });

  lastStatus = worker.status;
  lastLevel = worker.levelOfControl;
  otherExtensionControls = worker.levelOfControl === 'controlled_by_other_extensions';

  if (!label) {
    statusEl.textContent = 'Open your order on ProxyHubb and click "Turn on proxy". Or paste a pairing code below.';
    connectPanel.hidden = true;
    pairPanel.hidden = false;
    proxyEl.textContent = describeState(worker.status, worker.levelOfControl);
    renderVerify(worker.status);
    renderExpiry(worker.status);
    return;
  }

  connectPanel.hidden = false;
  pairPanel.hidden = true;
  try {
    const boot = await loadBootstrap();
    statusEl.textContent = `Signed in as ${boot.user.label || label}`;
    fillOrders(boot, worker.status.orderId);
  } catch {
    statusEl.textContent = `Signed in as ${label} (can't reach ProxyHubb right now, but Turn off still works)`;
    if (worker.status.orderId) {
      orderEl.replaceChildren();
      const opt = document.createElement('option');
      opt.value = worker.status.orderId;
      opt.textContent = worker.status.listingTitle || worker.status.orderId.slice(0, 8);
      orderEl.append(opt);
    }
    updateConnectButton();
  }
  proxyEl.textContent = describeState(worker.status, worker.levelOfControl);
  renderVerify(worker.status);
  renderExpiry(worker.status);
  updateConnectButton();
}

orderEl.addEventListener('change', () => {
  updateConnectButton();
});

pairBtn.addEventListener('click', async () => {
  showError('');
  try {
    const session = await pairFinish(codeEl.value);
    codeEl.value = '';
    statusEl.textContent = `Signed in as ${session.user.label || session.user.email}`;
    await refreshStatus();
  } catch (err) {
    showError(err instanceof Error ? friendlyError(err.message) : 'Pairing failed. Get a new code and try again.');
  }
});

connectBtn.addEventListener('click', async () => {
  showError('');
  const orderId = orderEl.value;
  if (!orderId) {
    showError('Buy a proxy on ProxyHubb first.');
    return;
  }
  if (otherExtensionControls) {
    showError(`Another extension is controlling ${BROWSER_NAME}'s proxy. Turn that one off first.`);
    return;
  }
  connectBtn.disabled = true;
  recheckBtn.disabled = true;
  try {
    const title = orderEl.selectedOptions[0]?.textContent ?? '';
    await sendWorker({ type: 'connect', orderId, listingTitle: title });
    await refreshStatus();
  } catch (err) {
    showError(err instanceof Error ? friendlyError(err.message) : 'Could not turn on the proxy.');
    await refreshStatus();
  } finally {
    updateConnectButton();
    recheckBtn.disabled = false;
  }
});

disconnectBtn.addEventListener('click', async () => {
  showError('');
  disconnectBtn.disabled = true;
  recheckBtn.disabled = true;
  try {
    await sendWorker({ type: 'disconnect' });
    await refreshStatus();
  } catch (err) {
    showError(err instanceof Error ? friendlyError(err.message) : 'Could not turn off the proxy.');
    await refreshStatus();
  } finally {
    disconnectBtn.disabled = false;
    recheckBtn.disabled = false;
  }
});

recheckBtn.addEventListener('click', async () => {
  showError('');
  recheckBtn.disabled = true;
  try {
    await sendWorker({ type: 'verify' });
    await refreshStatus();
  } catch (err) {
    showError(err instanceof Error ? friendlyError(err.message) : 'Could not check your IP.');
    await refreshStatus();
  } finally {
    recheckBtn.disabled = false;
  }
});

saveApiBtn.addEventListener('click', async () => {
  await setApiBase(apiEl.value);
  showError('');
});

apiEl.value = await getApiBase();
await renderIncognitoNote();
await refreshStatus();
