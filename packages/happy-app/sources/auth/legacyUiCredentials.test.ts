import { afterEach, expect, test, vi } from 'vitest';
import { importLegacyUiCredentials, markLegacyIdentityHandled } from './legacyUiCredentials';

afterEach(() => vi.unstubAllGlobals());
function browser() {
    const values = new Map<string, string>();
    vi.stubGlobal('location', { origin: 'https://agent.xcodex.vip' });
    vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) });
    const open = vi.fn(() => { throw new Error('Must not inspect another server identity'); });
    vi.stubGlobal('indexedDB', { open });
    return open;
}
test('never imports or authenticates an identity for a different server', async () => {
    const open = browser(), getToken = vi.fn();
    expect(await importLegacyUiCredentials('https://another.example', getToken)).toBeNull();
    expect(open).not.toHaveBeenCalled(); expect(getToken).not.toHaveBeenCalled();
});
test('explicit logout/import marker prevents silent sign-in on future visits', async () => {
    const open = browser(), getToken = vi.fn();
    markLegacyIdentityHandled();
    expect(await importLegacyUiCredentials('https://agent.xcodex.vip', getToken)).toBeNull();
    expect(open).not.toHaveBeenCalled(); expect(getToken).not.toHaveBeenCalled();
});
