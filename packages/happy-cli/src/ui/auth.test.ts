import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nacl from 'tweetnacl';

const mocks = vi.hoisted(() => ({
    post: vi.fn(),
    qr: vi.fn(),
    openBrowser: vi.fn(),
    writeCredentialsDataKey: vi.fn(),
}));

vi.mock('./qrcode', () => ({ displayQRCode: mocks.qr }));
vi.mock('axios', () => ({ default: { post: mocks.post } }));
vi.mock('@/configuration', () => ({ configuration: {
    serverUrl: 'https://agent.xcodex.vip',
    webappUrl: 'https://agent.xcodex.vip',
    currentCliVersion: '1.2.6',
} }));
vi.mock('@/utils/browser', () => ({ openBrowser: mocks.openBrowser }));
vi.mock('./logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('@/persistence', () => ({
    writeCredentialsDataKey: mocks.writeCredentialsDataKey,
    writeCredentialsLegacy: vi.fn(), readCredentials: vi.fn(), updateSettings: vi.fn(),
}));

import { doAuth } from './auth';

describe('AgentPort browser authorization', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'clear').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });
    afterEach(() => vi.restoreAllMocks());

    it('opens the browser directly and stores the key returned by authorization', async () => {
        const accountPublicKey = nacl.box.keyPair().publicKey;
        let requestKey: Uint8Array;
        mocks.post.mockImplementationOnce(async (_url, body) => {
            requestKey = new Uint8Array(Buffer.from(body.publicKey, 'base64'));
            return { data: { state: 'requested' } };
        }).mockImplementationOnce(async () => {
            expect(mocks.openBrowser).toHaveBeenCalledOnce();
            const ephemeral = nacl.box.keyPair();
            const nonce = nacl.randomBytes(24);
            const message = new Uint8Array([0, ...accountPublicKey]);
            const encrypted = nacl.box(message, nonce, requestKey, ephemeral.secretKey);
            return { data: {
                state: 'authorized', token: 'test-token',
                response: Buffer.concat([ephemeral.publicKey, nonce, encrypted]).toString('base64'),
            } };
        });
        mocks.openBrowser.mockResolvedValue(false); // SSH/headless fallback still permits approval.

        const result = await doAuth();

        const url = new URL(mocks.openBrowser.mock.calls[0][0]);
        expect(url.origin + url.pathname).toBe('https://agent.xcodex.vip/terminal/connect');
        expect(mocks.qr).toHaveBeenCalledWith(url.toString());
        expect(url.hash).toBe('#key=' + Buffer.from(requestKey!).toString('base64url'));
        expect(result?.encryption.type).toBe('dataKey');
        expect(mocks.writeCredentialsDataKey).toHaveBeenCalledWith(expect.objectContaining({
            publicKey: accountPublicKey, token: 'test-token',
        }));
    });

    it('does not launch a browser or store credentials when registration fails', async () => {
        mocks.post.mockRejectedValueOnce(new Error('unavailable'));
        expect(await doAuth()).toBeNull();
        expect(mocks.openBrowser).not.toHaveBeenCalled();
        expect(mocks.writeCredentialsDataKey).not.toHaveBeenCalled();
    });
});
