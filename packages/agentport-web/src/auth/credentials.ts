/**
 * Credential persistence. Default is in-memory only — a refresh loses the
 * session and the user must restore. The "remember this browser" option
 * stores the secret in IndexedDB, wrapped with authenticated encryption
 * keyed from a user-supplied unlock phrase. The phrase is never stored.
 */
export interface StoredCredentials {
    /** base64url-encoded 32-byte account secret. */
    secretBase64Url: string;
    /** Server token from the most recent successful /v1/auth. */
    token: string;
}

/**
 * IndexedDB-backed store for "remember this browser". The plaintext secret
 * is never stored; only the AES-GCM ciphertext + salt + params are.
 */
export interface IndexedDbRecord {
    version: 1;
    /** AES-GCM salt (12 bytes, base64). */
    salt: string;
    /** AES-GCM ciphertext + 16-byte auth tag (base64). */
    ciphertext: string;
    /** Which origin this record belongs to. */
    origin: string;
}

const DB_NAME = 'agentport-web-credentials';
const STORE_NAME = 'credentials';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function readStoredCredentials(): Promise<IndexedDbRecord | null> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get('default');
        req.onsuccess = () => {
            db.close();
            resolve((req.result as IndexedDbRecord) ?? null);
        };
        req.onerror = () => {
            db.close();
            reject(req.error);
        };
    });
}

export async function writeStoredCredentials(record: IndexedDbRecord): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(record, 'default');
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

export async function clearStoredCredentials(): Promise<void> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete('default');
        tx.oncomplete = () => {
            db.close();
            resolve();
        };
        tx.onerror = () => {
            db.close();
            reject(tx.error);
        };
    });
}

/**
 * Derive an AES-GCM key from a user-supplied unlock phrase.
 * Uses PBKDF2 with the stored salt. Returns the 256-bit key.
 */
export async function deriveKeyFromPhrase(phrase: string, salt: Uint8Array): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(phrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
    );
}

/** Encrypt a base64url secret with an AES-GCM key, producing salt+ciphertext. */
export async function encryptSecret(secretBase64Url: string, key: CryptoKey): Promise<{ salt: string; ciphertext: string }> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: salt },
        key,
        encoder.encode(secretBase64Url),
    ));
    return {
        salt: btoa(String.fromCharCode(...salt)),
        ciphertext: btoa(String.fromCharCode(...ciphertext)),
    };
}

/** Decrypt a secret previously produced by {@link encryptSecret}. */
export async function decryptSecret(saltB64: string, ciphertextB64: string, key: CryptoKey): Promise<string> {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const ciphertext = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: salt },
        key,
        ciphertext,
    );
    return new TextDecoder().decode(plaintext);
}
