/** @vitest-environment jsdom */
// Screen tests. These drive the real screens and the real state hook (through `Screens`) with a
// fake Rust side, so each test is one thing a provider can do, or one promise the window makes.
// The fake cannot be wrong about what a button does: the test only sees what the screen does.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Screens } from './App';
import type { Ipc } from './ipc';
import type {
  AppState,
  BlockedSitesSaved,
  Diagnosis,
  NodeSettings,
  RemoteView,
  RulesDraft,
  UpdateNotice,
} from './types';

afterEach(cleanup);

const NOW = Math.floor(Date.now() / 1000);

type SharingState = Extract<AppState, { kind: 'sharing' }>;
type ConnectingState = Extract<AppState, { kind: 'connecting' }>;

const ONLINE: RemoteView = {
  server: 'online',
  updated_at_unix: NOW - 60,
  earnings: { last_7_days_sol: 0.0412, last_30_days_sol: 0.1873, pending_sol: 0.0125, paid_sol: 0.9 },
};

function sharingWith(remote: RemoteView, over: Partial<SharingState> = {}): AppState {
  const base: SharingState = {
    kind: 'sharing',
    uptime_seconds: 600,
    bytes_up: 1000,
    bytes_down: 2000,
    active_connections: 3,
    managed_externally: false,
    details: {
      rate_up_kbps: 410,
      rate_down_kbps: 9200,
      total_connections: 1204,
      failed_connections: 17,
      latency_ms: 38,
      remote,
    },
  };
  return { ...base, ...over };
}

const sharing = (over: Partial<SharingState> = {}): AppState => sharingWith(ONLINE, over);

const connecting = (over: Partial<ConnectingState> = {}): AppState => ({
  kind: 'connecting',
  detail: null,
  retry: null,
  managed_externally: false,
  ...over,
});

const SETTINGS: NodeSettings = {
  config_path: 'C:\\Users\\you\\AppData\\Roaming\\proxyhubb\\provider.toml',
  gateways: ['proxy.proxyhubb.com:3128', 'proxy.proxyhubb.com:8443'],
  transport: 'yamux',
  use_tls: true,
  tls_skip_verify: false,
  max_connections: 500,
  bandwidth_limit_mbps: 100,
  allowed_ports: [80, 443, 8080, 8443],
  blocked_hosts: [],
  connection_type: 'residential',
};

const DRAFT: RulesDraft = {
  plan: {
    blocked: ['bet365.com', 'facebook.com'],
    added: [
      { host: 'facebook.com', source: 'named' },
      { host: 'bet365.com', source: 'category:gambling' },
    ],
    removed: [{ host: 'old.example', source: 'named' }],
    categories: [{ id: 'gambling', label: 'Gambling and betting', sites: 30, action: 'block' }],
    rejected: ['not a site'],
    notes: [{ level: 'info', message: 'Categories cover a short, fixed list.' }],
    assumptions: ['Gambling includes betting sites.'],
    cannotDo: ['Blocking only in the evenings is not possible.'],
    unchanged: false,
    refused: false,
  },
  model: 'muse-spark-1.3',
  dataMode: 'standard',
};

/** The fake Rust side: every command is a spy, and the test decides what each one answers. */
function fakeRustSide(first: AppState, notice: UpdateNotice | null = null) {
  let emit: ((s: AppState) => void) | null = null;
  const fns = {
    appState: vi.fn(async () => first),
    acceptConsent: vi.fn(async () => undefined),
    beginPairing: vi.fn(async () => undefined),
    cancelPairing: vi.fn(async () => undefined),
    setSharing: vi.fn(async () => undefined),
    stopOutsideNode: vi.fn(async () => undefined),
    restartNode: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => ({ archived_config: 'C:/p/provider.toml.disconnected-1' })),
    getNodeSettings: vi.fn(async () => SETTINGS),
    draftRules: vi.fn(async (): Promise<RulesDraft> => DRAFT),
    saveBlockedSites: vi.fn(
      async (sites: string[]): Promise<BlockedSitesSaved> => ({
        blockedHosts: sites,
        rejected: [],
        changed: true,
        restarted: true,
        needsRestart: false,
      }),
    ),
    getUpdateNotice: vi.fn(async () => notice),
    openTokensPage: vi.fn(async () => undefined),
    openDownloadPage: vi.fn(async () => undefined),
    openPairingLink: vi.fn(async () => undefined),
    openDashboard: vi.fn(async () => undefined),
    getAutostart: vi.fn(async () => false),
    setAutostart: vi.fn(async () => undefined),
    refreshAccount: vi.fn(async () => undefined),
    runDiagnosis: vi.fn(async (): Promise<Diagnosis> => ({ findings: [] })),
    saveSupportDetails: vi.fn(async () => 'C:/support/support-details-1.json'),
    onState: vi.fn(async (cb: (s: AppState) => void) => {
      emit = cb;
      return () => undefined;
    }),
    onPairingEnded: vi.fn(async () => () => undefined),
    onUpdate: vi.fn(async () => () => undefined),
  };
  return {
    ipc: fns as unknown as Ipc,
    fns,
    /** Simulate the node changing state, as the background loop does. */
    push: (s: AppState) =>
      act(() => {
        emit?.(s);
      }),
  };
}

async function open(first: AppState, notice: UpdateNotice | null = null) {
  const rust = fakeRustSide(first, notice);
  const view = render(<Screens ipc={rust.ipc} />);
  await screen.findByRole('heading', { level: 1 });
  return { ...rust, ...view };
}

describe('agreeing to what sharing means', () => {
  it('keeps Continue off until the box is ticked, then records consent once', async () => {
    const { fns } = await open({ kind: 'needs_consent' });
    const go = screen.getByRole('button', { name: 'I understand, continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(fns.acceptConsent).toHaveBeenCalledTimes(1));
  });

  it('Not now records nothing and says nothing is shared', async () => {
    const { fns } = await open({ kind: 'needs_consent' });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.getByRole('status').textContent).toContain('Nothing is shared until you agree');
    expect(fns.acceptConsent).not.toHaveBeenCalled();
  });
});

describe('connecting this computer', () => {
  it('Connect asks for a code, once', async () => {
    const { fns } = await open({ kind: 'needs_pairing' });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(fns.beginPairing).toHaveBeenCalledTimes(1));
  });

  it('shows the code to approve, and Open ProxyHubb and Cancel act on it', async () => {
    const { fns } = await open({
      kind: 'pairing',
      user_code: 'BCDF-GHJK',
      link: 'https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK',
      expires_in: 600,
    });
    expect(screen.getByLabelText('Your code is BCDF-GHJK')).toBeTruthy();
    expect(screen.getByText('Expires in 10:00')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open ProxyHubb' }));
    await waitFor(() => expect(fns.openPairingLink).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(fns.cancelPairing).toHaveBeenCalledTimes(1));
  });

  it('an expired code says so instead of counting down', async () => {
    await open({
      kind: 'pairing',
      user_code: 'BCDF-GHJK',
      link: 'https://proxyhubb.com/dashboard/provider/pair?code=BCDF-GHJK',
      expires_in: 0,
    });
    expect(screen.getByText('This code has expired. Cancel and try again.')).toBeTruthy();
  });
});

describe('a node this app started', () => {
  it('Pause sharing stops it', async () => {
    const { fns } = await open(sharing());
    fireEvent.click(screen.getByRole('button', { name: 'Pause sharing' }));
    await waitFor(() => expect(fns.setSharing).toHaveBeenCalledWith(false));
  });

  it('Restart node asks the node to start again', async () => {
    const { fns } = await open(sharing());
    fireEvent.click(screen.getByRole('button', { name: 'Restart node' }));
    await waitFor(() => expect(fns.restartNode).toHaveBeenCalledTimes(1));
  });

  it('a paused node resumes on Resume sharing', async () => {
    const { fns } = await open({ kind: 'paused' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume sharing' }));
    await waitFor(() => expect(fns.setSharing).toHaveBeenCalledWith(true));
  });

  it('a problem shows its reason, and Try again starts it again', async () => {
    const { fns } = await open({ kind: 'problem', reason: 'The node did not start. Please try again.' });
    expect(screen.getByRole('alert').textContent).toContain('The node did not start.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(fns.setSharing).toHaveBeenCalledWith(true));
  });
});

describe('a node started outside the app', () => {
  it('is never paused or restarted by the app, and gets only the confirmed stop', async () => {
    await open(sharing({ managed_externally: true }));
    expect(screen.queryByRole('button', { name: 'Pause sharing' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart node' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop this node…' })).toBeTruthy();
    expect(screen.getByText('Started outside this app, for example from the command line.')).toBeTruthy();
  });

  it('while still connecting, it can be stopped but not paused', async () => {
    await open(connecting({ managed_externally: true }));
    expect(screen.queryByRole('button', { name: 'Pause sharing' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop this node…' })).toBeTruthy();
  });

  it('the first press only asks, and Keep sharing changes nothing', async () => {
    const { fns } = await open(sharing({ managed_externally: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop this node…' }));
    const confirm = screen.getByRole('group', { name: 'Confirm stopping the node' });
    expect(fns.stopOutsideNode).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep sharing' }));
    expect(screen.queryByRole('group', { name: 'Confirm stopping the node' })).toBeNull();
    expect(fns.stopOutsideNode).not.toHaveBeenCalled();
  });

  it('the second press, Stop this node, stops it once', async () => {
    const { fns } = await open(sharing({ managed_externally: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop this node…' }));
    const confirm = screen.getByRole('group', { name: 'Confirm stopping the node' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Stop this node' }));
    await waitFor(() => expect(fns.stopOutsideNode).toHaveBeenCalledTimes(1));
  });
});

describe('what ProxyHubb says about this computer', () => {
  it('when online, says so and shows the earnings in SOL', async () => {
    await open(sharing());
    expect(screen.getByText('ProxyHubb sees this computer as online.')).toBeTruthy();
    expect(screen.getByText('0.0412 SOL')).toBeTruthy();
    expect(screen.getByText('0.0125 SOL')).toBeTruthy();
  });

  it('a refused key is said plainly, and no earnings are shown as zero', async () => {
    await open(sharingWith({ server: 'key_rejected', updated_at_unix: NOW - 30, earnings: null }));
    expect(screen.getByText(/did not accept this computer's key/)).toBeTruthy();
    expect(screen.getByText('Earnings could not be loaded right now.')).toBeTruthy();
    expect(screen.queryByText(/SOL/)).toBeNull();
  });

  it('while the first answer is pending it says so and claims nothing', async () => {
    await open(sharingWith({ server: 'checking', updated_at_unix: null, earnings: null }));
    expect(screen.getByText('Checking with ProxyHubb…')).toBeTruthy();
    expect(screen.getByText('Loading earnings…')).toBeTruthy();
  });

  it('Refresh asks the servers now', async () => {
    const { fns } = await open(sharing());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(fns.refreshAccount).toHaveBeenCalledTimes(1));
  });
});

describe('checking the connection', () => {
  it('runs in the background, and Pause stays usable while it runs', async () => {
    const { fns } = await open(connecting());
    let finish: (d: Diagnosis) => void = () => undefined;
    fns.runDiagnosis.mockImplementationOnce(
      () =>
        new Promise<Diagnosis>((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Check my connection' }));
    expect(screen.getByRole('button', { name: 'Checking… this can take a minute' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Pause sharing' }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      finish({ findings: [{ level: 'problem', text: 'The gateway could not be reached.' }] });
    });
    const items = await screen.findAllByRole('listitem');
    expect(items[0].textContent).toBe('Problem: The gateway could not be reached.');
  });

  it('with nothing wrong, it says so', async () => {
    await open(connecting());
    fireEvent.click(screen.getByRole('button', { name: 'Check my connection' }));
    expect(await screen.findByText(/The checks found nothing wrong on this computer/)).toBeTruthy();
  });

  it('a check that fails says why, in words', async () => {
    const { fns } = await open(connecting());
    fns.runDiagnosis.mockRejectedValueOnce('The check took too long and was stopped. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Check my connection' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The check took too long');
  });

  it('saving support details says where the file is', async () => {
    const { fns } = await open(connecting());
    fireEvent.click(screen.getByRole('button', { name: 'Save support details' }));
    await waitFor(() => expect(fns.saveSupportDetails).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Saved\. A folder window opened showing the file/)).toBeTruthy();
  });
});

describe('disconnecting this computer', () => {
  it('the first press only asks, and Cancel keeps the computer connected', async () => {
    const { fns } = await open(sharing());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer…' }));
    const group = screen.getByRole('group', { name: 'Confirm disconnecting this computer' });
    expect(fns.disconnect).not.toHaveBeenCalled();
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('group', { name: 'Confirm disconnecting this computer' })).toBeNull();
    expect(fns.disconnect).not.toHaveBeenCalled();
  });

  it('a confirmed disconnect ends on the connect screen with the reminder, and Open Tokens goes to the tokens page', async () => {
    const { fns, push } = await open(sharing());
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer…' }));
    const group = screen.getByRole('group', { name: 'Confirm disconnecting this computer' });
    fireEvent.click(within(group).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(fns.disconnect).toHaveBeenCalledTimes(1));
    push({ kind: 'needs_pairing' });
    expect(await screen.findByText('This computer is disconnected')).toBeTruthy();
    expect(screen.getByText(/The settings were kept in C:\/p\/provider\.toml\.disconnected-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open Tokens' }));
    await waitFor(() => expect(fns.openTokensPage).toHaveBeenCalledTimes(1));
  });

  it('a disconnect that fails changes nothing: still sharing, and it says why', async () => {
    const { fns } = await open(sharing());
    fns.disconnect.mockRejectedValueOnce(
      'The node did not stop in time, so nothing was disconnected. Please try again.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect this computer…' }));
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Confirm disconnecting this computer' })).getByRole('button', {
        name: 'Disconnect',
      }),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('did not stop in time');
    expect(screen.getByRole('heading', { name: /Sharing is on/ })).toBeTruthy();
    expect(screen.queryByText('This computer is disconnected')).toBeNull();
  });
});

describe('node settings', () => {
  it('are read when opened and shown in words, with the offer stated as an offer', async () => {
    const { fns, container } = await open(sharing());
    const details = container.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByText('Up to 500 connections and 100 Mbps')).toBeTruthy();
    expect(fns.getNodeSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByText('proxy.proxyhubb.com:3128, proxy.proxyhubb.com:8443')).toBeTruthy();
    expect(screen.queryByText(/Certificate checks for the gateway are turned off/)).toBeNull();
  });

  it('turned-off certificate checks are called out', async () => {
    const { fns, container } = await open(sharing());
    fns.getNodeSettings.mockResolvedValueOnce({ ...SETTINGS, tls_skip_verify: true });
    const details = container.querySelector('details') as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Certificate checks for the gateway are turned off');
  });
});

describe('blocked sites', () => {
  async function openPanel(first: AppState) {
    const opened = await open(first);
    opened.fns.getNodeSettings.mockResolvedValue({ ...SETTINGS, blocked_hosts: ['old.example'] });
    const details = [...opened.container.querySelectorAll('details')].find(
      (d) => d.querySelector('summary')?.textContent === 'Blocked sites',
    ) as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    expect(await screen.findByText('old.example')).toBeTruthy();
    return opened;
  }

  it('reads the list when opened; removing and adding sites then saves the new list', async () => {
    const { fns } = await openPanel(sharing());
    const save = screen.getByRole('button', { name: 'Save and apply' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Remove old.example' }));
    fireEvent.change(screen.getByLabelText('Block another site'), { target: { value: ' Facebook.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    expect(screen.getByText('facebook.com')).toBeTruthy();
    expect(screen.queryByText('old.example')).toBeNull();
    expect(save.disabled).toBe(false);

    fireEvent.click(save);
    await waitFor(() => expect(fns.saveBlockedSites).toHaveBeenCalledWith(['facebook.com']));
    expect(await screen.findByText(/node was restarted, so the new list is in force now/)).toBeTruthy();
  });

  it('drafts from the provider’s words, shows what changed and why, and uses the drafted list', async () => {
    const { fns } = await openPanel(sharing());
    const words = screen.getByLabelText('Or describe in your own words') as HTMLTextAreaElement;
    expect(words.maxLength).toBe(500);
    fireEvent.change(words, {
      target: { value: 'no gambling, never Facebook, stop blocking old.example, evenings only' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Draft a new list' }));
    await waitFor(() =>
      expect(fns.draftRules).toHaveBeenCalledWith(
        'no gambling, never Facebook, stop blocking old.example, evenings only',
      ),
    );

    expect(await screen.findByText('Gambling and betting: 30 sites blocked.')).toBeTruthy();
    expect(screen.getAllByText('(you named it)')).toHaveLength(2);
    expect(screen.getByText('(the Gambling and betting category)')).toBeTruthy();
    expect(screen.getByText('Gambling includes betting sites.')).toBeTruthy();
    expect(screen.getByText('Blocking only in the evenings is not possible.')).toBeTruthy();
    expect(screen.getByText('Categories cover a short, fixed list.')).toBeTruthy();
    expect(screen.getByText(/Not used: not a site\./)).toBeTruthy();
    expect(screen.getByText(/Drafted by muse-spark-1\.3, data mode standard/)).toBeTruthy();
    // Nothing is saved by drafting alone.
    expect(fns.saveBlockedSites).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Use this list' }));
    expect(screen.queryByRole('button', { name: 'Use this list' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }));
    await waitFor(() => expect(fns.saveBlockedSites).toHaveBeenCalledWith(['bet365.com', 'facebook.com']));
  });

  it('a failed draft is shown and leaves the list untouched', async () => {
    const { fns } = await openPanel(sharing());
    fns.draftRules.mockRejectedValueOnce('The model did not answer. Edit the list yourself.');
    fireEvent.change(screen.getByLabelText('Or describe in your own words'), { target: { value: 'no gambling' } });
    fireEvent.click(screen.getByRole('button', { name: 'Draft a new list' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The model did not answer.');
    expect(screen.getByText('old.example')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save and apply' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a node started elsewhere needs a restart for the list to apply', async () => {
    const { fns } = await openPanel(sharing({ managed_externally: true }));
    fns.saveBlockedSites.mockResolvedValueOnce({
      blockedHosts: [],
      rejected: [],
      changed: true,
      restarted: false,
      needsRestart: true,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove old.example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }));
    expect(await screen.findByText(/needs a restart/)).toBeTruthy();
  });

  it('says the list applies when sharing starts when the node is not running', async () => {
    const { fns } = await openPanel({ kind: 'paused' });
    fns.saveBlockedSites.mockResolvedValueOnce({
      blockedHosts: [],
      rejected: [],
      changed: true,
      restarted: false,
      needsRestart: false,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Remove old.example' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and apply' }));
    expect(await screen.findByText(/applies when sharing starts/)).toBeTruthy();
  });
});

describe('a newer version', () => {
  it('is named with both versions; Get it opens the download page; Not now hides it', async () => {
    const { fns } = await open({ kind: 'paused' }, { latest: '0.1.3', current: '0.1.2' });
    expect(await screen.findByText(/A newer version of ProxyHubb Provider is available \(0\.1\.3\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Get it' }));
    await waitFor(() => expect(fns.openDownloadPage).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/A newer version/)).toBeNull();
  });

  it('is not shown on the consent screen, before anything has been agreed', async () => {
    await open({ kind: 'needs_consent' }, { latest: '0.1.3', current: '0.1.2' });
    await act(async () => {});
    expect(screen.queryByText(/A newer version/)).toBeNull();
  });
});
