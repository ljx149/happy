import nacl from 'tweetnacl';

/** Encode a Uint8Array to a base64 or base64url string. */
export function encodeBase64(buffer: Uint8Array, variant: 'base64' | 'base64url' = 'base64'): string {
    const standard = btoa(String.fromCharCode(...buffer));
    if (variant === 'base64url') {
        return standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return standard;
}

/** Decode a base64 or base64url string to a Uint8Array. */
export function decodeBase64(base64: string, variant: 'base64' | 'base64url' = 'base64'): Uint8Array {
    let standard: string;
    if (variant === 'base64url') {
        standard = base64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64.length % 4) % 4);
    } else {
        standard = base64;
    }
    const binary = atob(standard);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

/**
 * Ed25519 signing key pair from a 32-byte seed.
 * Matches libsodium `crypto_sign_seed_keypair` and CLI's authChallenge:
 * `tweetnacl.sign.keyPair.fromSeed(secret)`.
 * The 32-byte account secret is used directly as the Ed25519 seed —
 * NOT via `fromSecretKey` (which expects a 64-byte secret key).
 */
export function signSeedKeypair(seed: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } {
    return nacl.sign.keyPair.fromSeed(seed);
}

/** Detached Ed25519 signature over `message`. */
export function signDetached(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return nacl.sign.detached(message, secretKey);
}

/** Verify a detached Ed25519 signature. */
export function signVerifyDetached(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
    return nacl.sign.detached.verify(message, signature, publicKey);
}

/**
 * X25519 box key pair seeded from a 32-byte secret.
 * Matches libsodium `crypto_box_seed_keypair`: secretKey = SHA-512(seed)[0:32],
 * publicKey = X25519 base-point multiple of that secret.
 * A DIFFERENT derivation path from signSeedKeypair — do not mix.
 */
export async function boxSeedKeypair(secret: Uint8Array): Promise<{ publicKey: Uint8Array; secretKey: Uint8Array }> {
    const boxSecret = await sha512First32(secret);
    const kp = nacl.box.keyPair.fromSecretKey(boxSecret);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * X25519 box key pair with a 32-byte random secret.
 * Matches libsodium `crypto_box_keypair` / tweetnacl `box.keyPair()`.
 * Used for terminal pairing ephemeral keys.
 */
export function boxKeypair(random?: (size: number) => Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array } {
    const secret = random ? random(32) : nacl.randomBytes(32);
    const kp = nacl.box.keyPair.fromSecretKey(secret);
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
}

/**
 * Encrypt `data` to `recipientPublicKey` with a fresh ephemeral box key.
 * Bundle layout: ephemeralPublicKey(32) || nonce(24) || ciphertext.
 * Matches CLI libsodiumEncryptForPublicKey and Kotlin encryptBox.
 * The ephemeral secret is 32 random bytes (libsodium crypto_box_keypair,
 * NOT SHA-512-derived).
 */
export function encryptBox(data: Uint8Array, recipientPublicKey: Uint8Array, random?: (size: number) => Uint8Array): Uint8Array {
    const ephemeral = boxKeypair(random);
    const nonce = random ? random(nacl.box.nonceLength) : nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(data, nonce, recipientPublicKey, ephemeral.secretKey)!;
    const bundle = new Uint8Array(ephemeral.publicKey.length + nonce.length + ciphertext.length);
    bundle.set(ephemeral.publicKey, 0);
    bundle.set(nonce, ephemeral.publicKey.length);
    bundle.set(ciphertext, ephemeral.publicKey.length + nonce.length);
    return bundle;
}

/**
 * Open a box bundle produced by {@link encryptBox}.
 * Returns null if the ciphertext does not authenticate.
 */
export function decryptBox(bundle: Uint8Array, secretKey: Uint8Array): Uint8Array | null {
    if (bundle.length < 32 + nacl.box.nonceLength + nacl.box.overheadLength) return null;
    const ephemeralPublicKey = bundle.slice(0, 32);
    const nonce = bundle.slice(32, 32 + nacl.box.nonceLength);
    const ciphertext = bundle.slice(32 + nacl.box.nonceLength);
    return nacl.box.open(ciphertext, nonce, ephemeralPublicKey, secretKey);
}

/**
 * Auth challenge: generate a random 32-byte challenge, sign it with the
 * account's Ed25519 key, and return all three pieces for POST /v1/auth.
 * Mirrors CLI authChallenge() and Android AuthChallenge.create().
 */
export function authChallenge(secret: Uint8Array, random?: (size: number) => Uint8Array): {
    challenge: Uint8Array;
    publicKey: Uint8Array;
    signature: Uint8Array;
} {
    const keypair = signSeedKeypair(secret);
    const challenge = random ? random(32) : nacl.randomBytes(32);
    const signature = signDetached(challenge, keypair.secretKey);
    return { challenge, publicKey: keypair.publicKey, signature };
}

/** SHA-512 of `data`, first 32 bytes. Used for content-key derivation (V2). */
export async function sha512First32(data: Uint8Array): Promise<Uint8Array> {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-512', data as BufferSource));
    return digest.slice(0, 32);
}
