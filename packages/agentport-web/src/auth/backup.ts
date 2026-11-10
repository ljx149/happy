import { encodeBase64, decodeBase64 } from './crypto';

/**
 * Human-readable form of the account secret: base32 (RFC 4648 alphabet,
 * no padding) in dash-separated groups of five. Mirrors the native
 * implementations (Android SecretKeyBackup.kt, iOS SecretKeyBackup.swift,
 * CLI secretKeyBackup.ts).
 *
 * The canonical storage form is base64url; the formatted form is what the
 * user sees and types.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function bytesToBase32(bytes: Uint8Array): string {
    let result = '';
    let buffer = 0;
    let bufferLength = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | (byte & 0xff);
        bufferLength += 8;
        while (bufferLength >= 5) {
            bufferLength -= 5;
            result += ALPHABET[(buffer >> bufferLength) & 0x1f];
        }
    }
    if (bufferLength > 0) {
        result += ALPHABET[(buffer << (5 - bufferLength)) & 0x1f];
    }
    return result;
}

function base32ToBytes(base32: string): Uint8Array {
    // Uppercase, map the usual look-alikes, then drop everything outside the alphabet.
    const normalized = base32
        .toUpperCase()
        .replace(/0/g, 'O')
        .replace(/1/g, 'I')
        .replace(/8/g, 'B')
        .replace(/9/g, 'G');
    const cleaned = normalized.split('').filter(c => (c >= 'A' && c <= 'Z') || (c >= '2' && c <= '7')).join('');
    if (cleaned.length === 0) throw new Error('No valid characters found');

    const bytes: number[] = [];
    let buffer = 0;
    let bufferLength = 0;
    for (const char of cleaned) {
        buffer = (buffer << 5) | ALPHABET.indexOf(char);
        bufferLength += 5;
        if (bufferLength >= 8) {
            bufferLength -= 8;
            bytes.push((buffer >> bufferLength) & 0xff);
        }
    }
    return new Uint8Array(bytes);
}

/** base64url secret -> "XXXXX-XXXXX-..." */
export function format(secretKeyBase64Url: string): string {
    const bytes = decodeBase64(secretKeyBase64Url, 'base64url');
    return bytesToBase32(bytes).match(/.{1,5}/g)!.join('-');
}

/** "XXXXX-XXXXX-..." (forgivingly) -> base64url secret. */
export function parse(formattedKey: string): string {
    const bytes = base32ToBytes(formattedKey);
    if (bytes.length !== 32) {
        throw new Error(`Invalid key length: expected 32 bytes, got ${bytes.length}`);
    }
    return encodeBase64(bytes, 'base64url');
}

export function isValid(key: string): boolean {
    try {
        if (key.includes('-')) {
            return decodeBase64(parse(key), 'base64url').length === 32;
        }
        return decodeBase64(key, 'base64url').length === 32;
    } catch {
        return false;
    }
}

/**
 * Accepts either form and returns the base64url secret. Same decision order
 * as the native implementations: anything with a dash or whitespace, or
 * longer than 50 characters, is read as the formatted key.
 */
export function normalize(key: string): string {
    const trimmed = key.trim();
    if (trimmed.split('').some(c => c === '-' || /\s/.test(c)) || trimmed.length > 50) {
        return parse(trimmed);
    }
    try {
        const bytes = decodeBase64(trimmed, 'base64url');
        if (bytes.length !== 32) throw new Error('Invalid secret key');
        return trimmed;
    } catch {
        return parse(trimmed);
    }
}
