import { expect, test } from 'vitest';
import { createDecipheriv } from 'node:crypto';
import nacl from 'tweetnacl';
import { contentKeys, decode, decryptRecord, deriveKey, encode, encryptRecord, openBox, sealBox, terminalApproval, unwrapKey } from './protocol.ts';

const master = new Uint8Array(32).fill(0xab);
const recordKey = new Uint8Array(32).fill(0xcd);
const record = { role: 'user', content: { type: 'text', text: 'vector-test' } };
const cliBundle = Buffer.from('00ef4b5cffaf9682348941eaddf8adfddfb69d755f92c6e56622a259918f6bbd86132b91d2a3105de8e5b6cc9235a4218619c660fcbe13a7171f47826d3add115c2c1a04109744eacc827bc4df0414b0dd770363fe9e6a40a1ae3a', 'hex');

test('matches Happy content seed and X25519 public key', async () => {
  expect(Buffer.from(await deriveKey(master, 'Happy EnCoder', ['content'])).toString('hex'))
    .toBe('f30653dfd9862bb061fa8628134c672245db078e2ddba93508e856b5b762802b');
  expect(Buffer.from((await contentKeys(master)).publicKey).toString('hex'))
    .toBe('1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c');
  expect(decode(encode(master, true))).toEqual(master);
});

test('V2 approval and wrapped record key use the Happy box envelope', async () => {
  const terminal = nacl.box.keyPair();
  const keys = await contentKeys(master);
  const approval = terminalApproval(keys.publicKey, terminal.publicKey);
  const plain = nacl.box.open(approval.slice(56), approval.slice(32, 56), approval.slice(0, 32), terminal.secretKey);
  expect(plain).toEqual(Uint8Array.of(0, ...keys.publicKey));
  const boxed = sealBox(recordKey, keys.publicKey);
  expect(openBox(boxed, keys.secretKey)).toEqual(recordKey);
  expect(unwrapKey(encode(Uint8Array.of(0, ...boxed)), keys.secretKey)).toEqual(recordKey);
});

test('opens the full CLI AES-GCM vector and Node can open the browser record', async () => {
  expect(await decryptRecord(encode(cliBundle), recordKey)).toEqual(record);
  await expect(decryptRecord(encode(cliBundle), new Uint8Array(32))).rejects.toThrow();
  const bundle = decode(await encryptRecord(record, recordKey));
  expect(bundle[0]).toBe(0);
  const decipher = createDecipheriv('aes-256-gcm', recordKey, bundle.slice(1, 13));
  decipher.setAuthTag(bundle.slice(-16));
  const plain = Buffer.concat([decipher.update(bundle.slice(13, -16)), decipher.final()]);
  expect(JSON.parse(plain.toString('utf8'))).toEqual(record);
});
