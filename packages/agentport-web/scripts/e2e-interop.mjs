#!/usr/bin/env node
/**
 * AgentPort Web Client — Phase 1 e2e interop test.
 * Runs against a live Self-host server. Validates the full acceptance flow:
 *   browser account create → CLI V2 pairing → CLI session create →
 *   browser decrypt history → browser send → CLI receive →
 *   CLI reply → browser receive → recovery credential in second browser.
 *
 * Usage: node scripts/e2e-interop.mjs --base http://127.0.0.1:3005
 */
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { execSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv.includes('--base')
  ? process.argv[process.argv.indexOf('--base') + 1]
  : 'http://127.0.0.1:3005';

const hex = b => Buffer.from(b).toString('hex');
const b64 = b => Buffer.from(b).toString('base64');
const b64u = b => Buffer.from(b).toString('base64');

// ── helpers: browser-side crypto (mirrors protocol.ts) ───────────────────
async function deriveKey(master, usage, pathList) {
  const keyObj = await crypto.subtle.importKey('raw', new Uint8Array(master), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const enc = new TextEncoder();
  let state = new Uint8Array(await crypto.subtle.sign('HMAC', keyObj, enc.encode(usage + ' Master Seed')));
  for (const idx of pathList) state = new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', state.slice(32), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']), enc.encode('\0' + idx)));
  return state.slice(0, 32);
}

async function contentKeys(master) {
  const seed = await deriveKey(master, 'Happy EnCoder', ['content']);
  const hashed = new Uint8Array(await crypto.subtle.digest('SHA-512', seed));
  const secretKey = hashed.slice(0, 32);
  return nacl.box.keyPair.fromSecretKey(secretKey);
}

function terminalApproval(contentPub, terminalPub) {
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const payload = new Uint8Array(33);
  payload.set([0], 0);
  payload.set(contentPub, 1);
  const ct = nacl.box(payload, nonce, terminalPub, eph.secretKey);
  const bundle = new Uint8Array(32 + 24 + ct.length);
  bundle.set(eph.publicKey, 0);
  bundle.set(nonce, 32);
  bundle.set(ct, 56);
  return bundle;
}

async function encryptRecord(value, key) {
  const nonce = new Uint8Array(12);
  crypto.getRandomValues(nonce);
  const encKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, encKey, new TextEncoder().encode(JSON.stringify(value))));
  const bundle = new Uint8Array(1 + 12 + ct.length);
  bundle.set([0], 0);
  bundle.set(nonce, 1);
  bundle.set(ct, 13);
  return bundle;
}

async function decryptRecord(value, key) {
  const bundle = Buffer.from(value, 'base64');
  const decKey = await crypto.subtle.importKey('raw', key, { name: 'AES-GCM' }, false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bundle.subarray(1, 13) }, decKey, bundle.subarray(13)));
  return JSON.parse(new TextDecoder().decode(plain));
}

function openBox(bundle, secretKey) {
  return nacl.box.open(bundle.subarray(56), bundle.subarray(32, 56), bundle.subarray(0, 32), secretKey);
}

async function postAuth(master) {
  const kp = nacl.sign.keyPair.fromSeed(master);
  const challenge = nacl.randomBytes(32);
  const sig = nacl.sign.detached(challenge, kp.secretKey);
  const res = await fetch(`${base}/v1/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publicKey: b64(kp.publicKey), challenge: b64(challenge), signature: b64(sig) }),
  });
  assert.ok(res.ok, `POST /v1/auth should succeed, got ${res.status}`);
  const json = await res.json();
  assert.ok(json.token, 'response must include token');
  return json.token;
}

// ── test 1: account creation ─────────────────────────────────────────────
async function testAccountCreate() {
  const master = nacl.randomBytes(32);
  const token = await postAuth(master);
  assert.ok(token.length > 10, 'token is non-trivial');
  console.log('  ✓ account created, token received');
  return { master, token };
}

// ── test 2: V2 terminal pairing ──────────────────────────────────────────
async function testV2Pairing(browserToken) {
  // browser generates ephemeral keypair (simulates CLI)
  const terminal = nacl.box.keyPair();
  // POST /v1/auth/request with supportsV2
  const reqRes = await fetch(`${base}/v1/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${browserToken}` },
    body: JSON.stringify({ publicKey: b64(terminal.publicKey), supportsV2: true }),
  });
  assert.equal(reqRes.status, 200);
  const reqState = await reqRes.json();
  assert.equal(reqState.state, 'requested');

  // browser approves: box(0x00 || contentPub, terminalPub)
  const browserMaster = nacl.randomBytes(32);
  const { publicKey: contentPub } = await contentKeys(browserMaster);
  const browserToken2 = await postAuth(browserMaster);
  const approval = terminalApproval(contentPub, terminal.publicKey);
  const appRes = await fetch(`${base}/v1/auth/response`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${browserToken2}` },
    body: JSON.stringify({ publicKey: b64(terminal.publicKey), response: b64(approval) }),
  });
  assert.ok(appRes.ok, `approve should succeed, got ${appRes.status}`);

  // CLI polls and gets the encrypted response
  const pollRes = await fetch(`${base}/v1/auth/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${browserToken}` },
    body: JSON.stringify({ publicKey: b64(terminal.publicKey), supportsV2: true }),
  });
  const poll = await pollRes.json();
  assert.equal(poll.state, 'authorized');
  const decrypted = openBox(Buffer.from(poll.response, 'base64'), terminal.secretKey);
  assert.ok(decrypted, 'box open succeeded');
  assert.equal(decrypted[0], 0, 'version byte is 0');
  assert.equal(Buffer.from(decrypted.slice(1, 33)).toString('hex'), Buffer.from(contentPub).toString('hex'));
  console.log('  ✓ V2 pairing: CLI decrypted 0x00||contentPub correctly');
  return { browserMaster, browserToken: browserToken2, contentPub };
}

// ── test 3: CLI creates dataKey session ───────────────────────────────────
async function testSessionCreate(browserToken, contentPub) {
  const aesKey = nacl.randomBytes(32);
  // CLI boxes the AES key to the browser's contentPub
  const eph = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ct = nacl.box(aesKey, nonce, contentPub, eph.secretKey);
  const boxed = new Uint8Array(32 + 24 + ct.length);
  boxed.set(eph.publicKey, 0); boxed.set(nonce, 32); boxed.set(ct, 56);
  const deks = new Uint8Array(1 + boxed.length);
  deks.set([0], 0); deks.set(boxed, 1);

  // create session with encrypted metadata
  const metadata = { title: 'e2e test session', tag: 'e2e-test' };
  const encMetadata = await encryptRecord(metadata, aesKey);
  const res = await fetch(`${base}/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${browserToken}` },
    body: JSON.stringify({
      tag: 'e2e-test',
      metadata: b64(encMetadata),
      dataEncryptionKey: b64(deks),
    }),
  });
  assert.ok(res.ok, `session create: ${res.status}`);
  const json = await res.json();
  assert.ok(json.session, 'response has session');
  console.log(`  ✓ session created: ${json.session.id}`);
  return { sessionId: json.session.id, aesKey };
}

// ── test 4: browser unwraps dataKey and decrypts history ─────────────────
async function testBrowserDecrypt(browserToken, browserMaster, sessionId, aesKey) {
  const sessionsRes = await fetch(`${base}/v1/sessions`, {
    headers: { 'Authorization': `Bearer ${browserToken}` },
  });
  const sessions = await sessionsRes.json();
  const session = sessions.sessions.find(s => s.id === sessionId);
  assert.ok(session, 'session visible in browser');

  // unwrap the AES key
  const deks = Buffer.from(session.dataEncryptionKey, 'base64');
  const contentSecret = await contentKeys(browserMaster);
  const unwrapped = openBox(deks.subarray(1), contentSecret.secretKey);
  assert.deepEqual(Buffer.from(unwrapped).toString('hex'), Buffer.from(aesKey).toString('hex'), 'unwrapped AES key matches');

  // send a message from CLI, browser reads it
  const msg = { role: 'agent', content: { type: 'text', text: 'hello from CLI' } };
  const enc = await encryptRecord(msg, aesKey);
  const sendRes = await fetch(`${base}/v3/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${browserToken}` },
    body: JSON.stringify({ messages: [{ content: b64(enc), localId: crypto.randomUUID() }] }),
  });
  assert.ok(sendRes.ok, `send message: ${sendRes.status}`);

  const fetchRes = await fetch(`${base}/v3/sessions/${sessionId}/messages?after_seq=0&limit=100`, {
    headers: { 'Authorization': `Bearer ${browserToken}` },
  });
  const fetched = await fetchRes.json();
  assert.ok(fetched.messages.length >= 1, 'browser fetched at least 1 message');
  const dec = await decryptRecord(fetched.messages[0].content.c, aesKey);
  assert.equal(dec.content.text, 'hello from CLI');
  console.log('  ✓ browser unwrapped AES key and decrypted message');
}

// ── test 5: bidirectional messaging ──────────────────────────────────────
async function testBidirectional(browserToken, sessionId, aesKey) {
  // browser → CLI
  const browserMsg = { role: 'user', content: { type: 'text', text: 'browser says hi' } };
  const enc1 = await encryptRecord(browserMsg, aesKey);
  await fetch(`${base}/v3/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${browserToken}` },
    body: JSON.stringify({ messages: [{ content: b64(enc1), localId: crypto.randomUUID() }] }),
  });

  // CLI reads (same key)
  const cliRes = await fetch(`${base}/v3/sessions/${sessionId}/messages?after_seq=0&limit=100`, {
    headers: { 'Authorization': `Bearer ${browserToken}` },
  });
  const cliMsgs = await cliRes.json();
  const last = cliMsgs.messages.at(-1);
  assert.equal((await decryptRecord(last.content.c, aesKey)).content.text, 'browser says hi');
  console.log('  ✓ bidirectional: browser → CLI → decrypt ok');
}

// ── test 6: recovery in second browser ───────────────────────────────────
async function testRecovery(browserMaster, browserToken, sessionId) {
  const recoveryCredential = b64(browserMaster);
  const secondToken = await postAuth(Buffer.from(recoveryCredential, 'base64'));
  // The server issues a fresh JWT per authenticate (different jti), so tokens
  // differ. Recovery correctness = same account subject (sub) + same session visible.
  const sub = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub;
  assert.equal(sub(secondToken), sub(browserToken), 'same account subject (sub) after recovery');
  const sessionsRes = await fetch(`${base}/v1/sessions`, {
    headers: { 'Authorization': `Bearer ${secondToken}` },
  });
  const sessions = await sessionsRes.json();
  assert.ok(sessions.sessions.find(s => s.id === sessionId), 'second browser sees the same session');
  console.log('  ✓ recovery: same account subject, same session visible in second browser');
}

// ── main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`AgentPort e2e interop — base: ${base}\n`);

  // health check
  const health = await fetch(`${base}/health`);
  assert.ok(health.ok, 'server must be healthy');
  const healthJson = await health.json();
  assert.equal(healthJson.status, 'ok');
  console.log('✓ server healthy');

  const { master: browserMaster0, token: browserToken0 } = await testAccountCreate();
  const { browserMaster, browserToken, contentPub } = await testV2Pairing(browserToken0);
  const { sessionId, aesKey } = await testSessionCreate(browserToken, contentPub);
  await testBrowserDecrypt(browserToken, browserMaster, sessionId, aesKey);
  await testBidirectional(browserToken, sessionId, aesKey);
  await testRecovery(browserMaster, browserToken, sessionId);

  console.log('\n✓ all e2e checks passed');
}

main().catch(e => { console.error('\n✗ e2e failed:', e.message); process.exit(1); });
