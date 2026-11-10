import { describe, it, expect } from 'vitest';
import { deriveKey, contentPublicKey, buildV2ApproverResponse, openV2Response, parsePairingLink, pairingLinkKey } from './pairing';
import { boxSeedKeypair, boxKeypair } from './crypto';
import rawVectors from '../../test/resources/happy-ts-vectors.json';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vectors = rawVectors as any;

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

describe('deriveKey (HMAC-SHA512 key tree)', () => {
    it('matches TS deriveKey vectors', async () => {
        for (const v of vectors.deriveKey) {
            const seed = hexToBytes(v.seedHex);
            const derived = await deriveKey(seed, v.usage, v.path);
            expect(bytesToHex(derived)).toBe(v.keyHex);
        }
    });
});

describe('contentPublicKey (V2 pairing)', () => {
    it('matches accountEncryption vector contentPublicKeyHex', async () => {
        for (const v of vectors.accountEncryption) {
            const pub = await contentPublicKey(hexToBytes(v.masterSecretHex));
            expect(bytesToHex(pub)).toBe(v.contentPublicKeyHex);
        }
    });

    it('buildV2ApproverResponse decrypts to 0x00 || contentPub', async () => {
        for (const v of vectors.accountEncryption) {
            const master = hexToBytes(v.masterSecretHex);
            // CLI's ephemeral box keypair (ui/auth.ts doAuth: box.keyPair.fromSecretKey).
            const cliKp = boxKeypair();
            // Approver seals 0x00||contentPub to the CLI's public key.
            const response = await buildV2ApproverResponse(master, cliKp.publicKey);
            const opened = openV2Response(response, cliKp.secretKey);
            expect(opened).not.toBeNull();
            expect(opened![0]).toBe(0x00);
            expect(bytesToHex(opened!.slice(1))).toBe(v.contentPublicKeyHex);
        }
    });
});

describe('parsePairingLink', () => {
    it('extracts the ephemeral public key from #key=...', () => {
        const pub = new Uint8Array(32).fill(0xab);
        const hash = `#key=${pairingLinkKey(pub)}`;
        const parsed = parsePairingLink(hash);
        expect(bytesToHex(parsed!)).toBe(bytesToHex(pub));
    });

    it('rejects malformed keys', () => {
        expect(parsePairingLink('#key=tooshort')).toBeNull();
        expect(parsePairingLink('no-hash')).toBeNull();
    });
});
