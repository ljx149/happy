import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { localIdentity } from './credentials';
import { AuthStore } from './authStore';
import { decodeBase64Url, encodeBase64 } from './crypto';

const cfg = { baseUrl: 'http://fake-server:3005' };

/** /v1/auth always succeeds and mints a fixed token; /v1/machines only accepts that token. */
function mockServer() {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/v1/auth')) {
            return new Response(JSON.stringify({ success: true, token: 'minted-token' }), { status: 200 });
        }
        if (url.includes('/v1/machines')) {
            const auth = (init?.headers as Record<string, string>)?.Authorization ?? '';
            return new Response('[]', { status: auth === 'Bearer minted-token' ? 200 : 401 });
        }
        return new Response('not found', { status: 404 });
    });
}

describe('AuthStore state machine', () => {
    beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
    afterEach(() => vi.unstubAllGlobals());

    it('logout clears the in-memory identity', async () => {
        vi.stubGlobal('fetch', mockServer());
        const store = new AuthStore(cfg);
        await store.createAccount();
        await store.logout();
        expect(store.getState().phase).toBe('signedOut');
    });

    it('restores the same identity in a fresh store after reload', async () => {
        vi.stubGlobal('fetch', mockServer());
        const first = new AuthStore(cfg);
        const created = await first.createAccount();
        const reloaded = new AuthStore(cfg);
        await reloaded.startup();
        expect(reloaded.getState()).toMatchObject({
            phase: 'signedIn', secretBase64Url: created.secretBase64Url,
        });
    });

    it('logout removes the persisted identity so reload stays signed out', async () => {
        vi.stubGlobal('fetch', mockServer());
        const first = new AuthStore(cfg);
        await first.createAccount();
        await first.logout();
        const reloaded = new AuthStore(cfg);
        await reloaded.startup();
        expect(reloaded.getState().phase).toBe('signedOut');
        expect(await localIdentity(cfg.baseUrl, 'read')).toBeNull();
    });

    it('does not restore or delete another server identity', async () => {
        const fetchMock = mockServer();
        vi.stubGlobal('fetch', fetchMock);
        const first = new AuthStore(cfg);
        const created = await first.createAccount();
        fetchMock.mockClear();
        const other = new AuthStore({ baseUrl: 'https://other-server.example' });
        await other.startup();
        expect(other.getState().phase).toBe('signedOut');
        expect(fetchMock).not.toHaveBeenCalled();
        await other.logout();
        expect(await localIdentity(cfg.baseUrl, 'read')).toBe(created.secretBase64Url);
    });

    it('keeps the saved identity when automatic login encounters a network failure', async () => {
        vi.stubGlobal('fetch', mockServer());
        const first = new AuthStore(cfg);
        const created = await first.createAccount();
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
        const reloaded = new AuthStore(cfg);
        await reloaded.startup();
        expect(reloaded.getState()).toMatchObject({ phase: 'error', retryable: true });
        expect(await localIdentity(cfg.baseUrl, 'read')).toBe(created.secretBase64Url);
    });

    it('401 on a protected endpoint drops back to signedOut', async () => {
        vi.stubGlobal('fetch', mockServer());
        const store = new AuthStore(cfg);
        await store.createAccount();
        expect(store.getState().phase).toBe('signedIn');
        store.handleUnauthorized();
        expect(store.getState().phase).toBe('signedOut');
    });

    it('network failure is retryable', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
        const store = new AuthStore(cfg);
        await expect(store.restore(encodeBase64(new Uint8Array(32), 'base64url'))).rejects.toThrow();
        const s = store.getState();
        expect(s.phase).toBe('error');
        if (s.phase === 'error') expect(s.retryable).toBe(true);
    });

    it('a 401 credential error is not retryable', async () => {
        const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 }));
        vi.stubGlobal('fetch', fetchMock);
        const store = new AuthStore(cfg);
        await expect(store.restore(encodeBase64(new Uint8Array(32), 'base64url'))).rejects.toThrow();
        const s = store.getState();
        expect(s.phase).toBe('error');
        if (s.phase === 'error') expect(s.retryable).toBe(false);
    });

    it('concurrent restores share one in-flight operation', async () => {
        vi.stubGlobal('fetch', mockServer());
        const store = new AuthStore(cfg);
        const key = encodeBase64(new Uint8Array(32), 'base64url');
        const p1 = store.restore(key);
        const p2 = store.restore(key); // must reject: already in progress
        await expect(p2).rejects.toThrow('already in progress');
        await p1;
        expect(store.getState().phase).toBe('signedIn');
    });
});

describe('decodeBase64Url length guard', () => {
    it('rejects a non-32-byte secret', () => {
        expect(() => decodeBase64Url(encodeBase64(new Uint8Array(31), 'base64url'))).toThrow('Expected 32 bytes');
        expect(decodeBase64Url(encodeBase64(new Uint8Array(32), 'base64url'))).toHaveLength(32);
    });
});
