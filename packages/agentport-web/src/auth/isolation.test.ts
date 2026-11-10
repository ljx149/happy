import { describe, it, expect, vi, afterEach } from 'vitest';
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

/** In-memory IndexedDB stub for the node vitest environment. */
function installIndexedDbStub() {
    const stores = new Map<string, Map<string, unknown>>();
    const getStore = (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        return stores.get(name)!;
    };
    const makeReq = (result?: unknown) => {
        const req: { onsuccess?: () => void; onerror?: () => void; result?: unknown } = { result };
        queueMicrotask(() => { req.onsuccess?.(); });
        return req;
    };
    const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: (name: string) => { getStore(name); },
        transaction: (name: string) => {
            const tx: { objectStore: () => unknown; oncomplete?: () => void } = {
                objectStore: () => ({
                    put: (val: unknown, key: string) => { getStore(name).set(key, val); return makeReq(); },
                    delete: (key: string) => { getStore(name).delete(key); return makeReq(); },
                    get: (key: string) => makeReq(getStore(name).get(key)),
                }),
            };
            queueMicrotask(() => { tx.oncomplete?.(); });
            return tx;
        },
        close: () => {},
    };
    vi.stubGlobal('indexedDB', {
        open: () => {
            const req: { onsuccess?: () => void; onerror?: () => void; result?: unknown } = { result: db };
            queueMicrotask(() => { req.onsuccess?.(); });
            return req;
        },
    });
}

describe('AuthStore state machine', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('logout clears the in-memory identity', async () => {
        installIndexedDbStub();
        vi.stubGlobal('fetch', mockServer());
        const store = new AuthStore(cfg);
        await store.createAccount();
        await store.logout();
        expect(store.getState().phase).toBe('signedOut');
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
