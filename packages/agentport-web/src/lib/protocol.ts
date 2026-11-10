import nacl from 'tweetnacl';

const utf8 = new TextEncoder();
const decoder = new TextDecoder();

export function encode(bytes: Uint8Array, url = false): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 = btoa(binary);
  return url ? base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '') : base64;
}

export function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0));
}

async function hmac(key: Uint8Array<ArrayBuffer>, input: Uint8Array<ArrayBuffer>) {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, input));
}

export async function deriveKey(master: Uint8Array<ArrayBuffer>, usage: string, path: string[]) {
  let state = await hmac(utf8.encode(usage + ' Master Seed'), master);
  for (const index of path) state = await hmac(state.slice(32), utf8.encode('\0' + index));
  return state.slice(0, 32);
}

export async function contentKeys(master: Uint8Array<ArrayBuffer>) {
  const seed = await deriveKey(master, 'Happy EnCoder', ['content']);
  const hash = await crypto.subtle.digest('SHA-512', seed);
  return nacl.box.keyPair.fromSecretKey(new Uint8Array(hash, 0, 32));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

export function sealBox(payload: Uint8Array, recipient: Uint8Array) {
  const ephemeral = nacl.box.keyPair();
  const nonce = crypto.getRandomValues(new Uint8Array(24));
  return concat(ephemeral.publicKey, nonce, nacl.box(payload, nonce, recipient, ephemeral.secretKey));
}

export function openBox(bundle: Uint8Array, secret: Uint8Array) {
  if (bundle.length < 72) return null;
  return nacl.box.open(bundle.subarray(56), bundle.subarray(32, 56), bundle.subarray(0, 32), secret);
}

export function terminalApproval(contentPublicKey: Uint8Array, terminalPublicKey: Uint8Array) {
  return sealBox(concat(Uint8Array.of(0), contentPublicKey), terminalPublicKey);
}

export function unwrapKey(wrapped: string, secret: Uint8Array) {
  const bytes = decode(wrapped);
  const key = bytes[0] === 0 ? openBox(bytes.subarray(1), secret) : null;
  if (key?.length !== 32) throw new Error('无法解封数据密钥');
  return new Uint8Array(key);
}

async function aes(key: Uint8Array<ArrayBuffer>, operation: 'encrypt' | 'decrypt') {
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, [operation]);
}

export async function encryptRecord(value: unknown, key: Uint8Array<ArrayBuffer>) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, await aes(key, 'encrypt'), utf8.encode(JSON.stringify(value)));
  return encode(concat(Uint8Array.of(0), nonce, new Uint8Array(data)));
}

export async function decryptRecord(value: string, key: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const bytes = decode(value);
  if (bytes.length < 29 || bytes[0] !== 0) throw new Error('不支持的加密记录格式');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(1, 13) }, await aes(key, 'decrypt'), bytes.subarray(13));
  return JSON.parse(decoder.decode(plain));
}

export function signedChallenge(master: Uint8Array) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const signing = nacl.sign.keyPair.fromSeed(master);
  return {
    publicKey: encode(signing.publicKey),
    challenge: encode(challenge),
    signature: encode(nacl.sign.detached(challenge, signing.secretKey)),
  };
}
