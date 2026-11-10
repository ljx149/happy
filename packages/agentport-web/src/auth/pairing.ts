import { encodeBase64, boxSeedKeypair, encryptBox, decryptBox } from './crypto';

/**
 * HMAC-SHA512 key-tree derivation, mirroring happy-app's deriveKey.ts and the
 * native KeyDerivation.kt. Used to derive the content key that V2 pairing
 * sends to the CLI.
 *
 *   deriveKey(master, 'Happy EnCoder', ['content'])
 *     -> contentDataKey (32 bytes)
 *     -> boxSeedKeypair(contentDataKey).publicKey = contentPub
 *
 * The approver seals `0x00 || contentPub` (33 bytes) to the CLI's ephemeral
 * public key; the CLI decrypts it and uses contentPub as the dataKey
 * recipient for per-session keys.
 */

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const cryptoKey = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, data as BufferSource));
}

interface KeyTreeState { key: Uint8Array; chainCode: Uint8Array }

async function rootState(seed: Uint8Array, usage: string): Promise<KeyTreeState> {
    const keyBytes = new TextEncoder().encode(`${usage} Master Seed`);
    const i = await hmacSha512(keyBytes, seed);
    return { key: i.slice(0, 32), chainCode: i.slice(32, 64) };
}

async function childState(chainCode: Uint8Array, index: string): Promise<KeyTreeState> {
    // 0x00 separator, then the UTF-8 index.
    const data = new Uint8Array(1 + new TextEncoder().encode(index).length);
    data.set([0], 0);
    data.set(new TextEncoder().encode(index), 1);
    const i = await hmacSha512(chainCode, data);
    return { key: i.slice(0, 32), chainCode: i.slice(32, 64) };
}

/** deriveKey(master, usage, path) — async because WebCrypto HMAC is async. */
export async function deriveKey(master: Uint8Array, usage: string, path: string[]): Promise<Uint8Array> {
    let state = await rootState(master, usage);
    for (const index of path) {
        state = await childState(state.chainCode, index);
    }
    return state.key;
}

/** The account's content public key, sent to the CLI during V2 pairing. */
export async function contentPublicKey(masterSecret: Uint8Array): Promise<Uint8Array> {
    const contentDataKey = await deriveKey(masterSecret, 'Happy EnCoder', ['content']);
    const kp = await boxSeedKeypair(contentDataKey);
    return kp.publicKey;
}

/**
 * Build the V2 approver response: `0x00 || contentPub` (33 bytes) sealed to
 * the CLI's ephemeral public key. This is the `response` field of
 * POST /v1/auth/response.
 */
export async function buildV2ApproverResponse(
    masterSecret: Uint8Array,
    cliEphemeralPublicKey: Uint8Array,
    random?: (size: number) => Uint8Array,
): Promise<Uint8Array> {
    const pub = await contentPublicKey(masterSecret);
    const payload = new Uint8Array(1 + pub.length);
    payload[0] = 0x00;
    payload.set(pub, 1);
    return encryptBox(payload, cliEphemeralPublicKey, random);
}

/**
 * Decode the CLI's pairing link. The CLI generates
 * `<webappUrl>/terminal/connect#key=<base64url-ephemeral-public-key>`.
 * Returns the 32-byte ephemeral public key, or null if malformed.
 */
export function parsePairingLink(hash: string): Uint8Array | null {
    // hash looks like "#key=<base64url>"
    const match = hash.match(/#key=([A-Za-z0-9_-]+)/);
    if (!match) return null;
    const b64url = match[1];
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64url.length % 4) % 4);
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes.length === 32 ? bytes : null;
}

/** Re-encode a public key the way the CLI expects it in a link. */
export function pairingLinkKey(publicKey: Uint8Array): string {
    return encodeBase64(publicKey, 'base64url');
}

/** Decrypt a V2 approver response the CLI produced (test helper). */
export function openV2Response(bundle: Uint8Array, recipientSecretKey: Uint8Array): Uint8Array | null {
    return decryptBox(bundle, recipientSecretKey);
}
