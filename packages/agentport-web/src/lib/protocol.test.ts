import assert from 'node:assert/strict';
import { createDecipheriv } from 'node:crypto';
import test from 'node:test';
import nacl from 'tweetnacl';
import { contentKeys, decode, decryptRecord, deriveKey, encode, encryptRecord, openBox, sealBox, terminalApproval, unwrapKey } from './protocol.ts';

const master = new Uint8Array(32).fill(0xab);
const recordKey = new Uint8Array(32).fill(0xcd);
const record = { role: 'user', content: { type: 'text', text: 'vector-test' } };
const cliBundle = Buffer.from('00ef4b5cffaf9682348941eaddf8adfddfb69d755f92c6e56622a259918f6bbd86132b91d2a3105de8e5b6cc9235a4218619c660fcbe13a7171f47826d3add115c2c1a04109744eacc827bc4df0414b0dd770363fe9e6a40a1ae3a', 'hex');

test('matches Happy content seed and X25519 public key', async () => {
  assert.equal(Buffer.from(await deriveKey(master, 'Happy EnCoder', ['content'])).toString('hex'),
    'f30653dfd9862bb061fa8628134c672245db078e2ddba93508e856b5b762802b');
  assert.equal(Buffer.from((await contentKeys(master)).publicKey).toString('hex'),
    '1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c');
  assert.deepEqual(decode(encode(master, true)), master);
});

test('V2 approval and wrapped record key use the Happy box envelope', async () => {
  const terminal = nacl.box.keyPair();
  const keys = await contentKeys(master);
  const approval = terminalApproval(keys.publicKey, terminal.publicKey);
  const plain = nacl.box.open(approval.slice(56), approval.slice(32, 56), approval.slice(0, 32), terminal.secretKey);
  assert.deepEqual(plain, Uint8Array.of(0, ...keys.publicKey));
  const boxed = sealBox(recordKey, keys.publicKey);
  assert.deepEqual(openBox(boxed, keys.secretKey), recordKey);
  assert.deepEqual(unwrapKey(encode(Uint8Array.of(0, ...boxed)), keys.secretKey), recordKey);
});

test('opens the full CLI AES-GCM vector and Node can open the browser record', async () => {
  assert.deepEqual(await decryptRecord(encode(cliBundle), recordKey), record);
  await assert.rejects(decryptRecord(encode(cliBundle), new Uint8Array(32)));
  const bundle = decode(await encryptRecord(record, recordKey));
  assert.equal(bundle[0], 0);
  const decipher = createDecipheriv('aes-256-gcm', recordKey, bundle.slice(1, 13));
  decipher.setAuthTag(bundle.slice(-16));
  const plain = Buffer.concat([decipher.update(bundle.slice(13, -16)), decipher.final()]);
  assert.deepEqual(JSON.parse(plain.toString('utf8')), record);
});
