function probeUrl(baseURL: string): string {
    try {
        const u = new URL(baseURL);
        if (u.hostname === 'localhost') {
            u.hostname = '127.0.0.1';
        }
        return u.toString();
    } catch {
        return baseURL.replace('localhost', '127.0.0.1');
    }
}

async function isServerUp(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(4000),
        });
        // Any HTTP response means something is listening (even 404/redirect).
        return res.status > 0 && res.status < 600;
    } catch {
        return false;
    }
}

export default async function globalSetup() {
    if (!process.env.TEST_BASE_URL) {
        return;
    }

    const baseURL = process.env.TEST_BASE_URL;
    const url = probeUrl(baseURL);
    const deadline = Date.now() + 90_000;

    while (Date.now() < deadline) {
        if (await isServerUp(url)) {
            return;
        }
        await new Promise((r) => setTimeout(r, 1500));
    }

    throw new Error(
        [
            `No response from TEST_BASE_URL (${baseURL}) after 90s.`,
            '',
            'Keep the dev server running in a separate terminal (do not close it):',
            '  cd apps/web',
            "  $env:PLAYWRIGHT_E2E_AUTH_BYPASS = '1'",
            '  npm run dev:e2e',
            '',
            'Wait until compile finishes (not only "Ready" — let middleware finish), then run tests.',
            '',
            'Quick check:',
            '  Invoke-WebRequest http://127.0.0.1:4011 -UseBasicParsing',
            '',
            'Or let Playwright start dev for you:',
            '  Remove-Item Env:TEST_BASE_URL -ErrorAction SilentlyContinue',
            '  npm run test:e2e:map',
        ].join('\n')
    );
}
