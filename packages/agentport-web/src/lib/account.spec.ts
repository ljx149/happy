import { expect, test } from 'vitest';
import nacl from 'tweetnacl';
import { deviceAgentSupport } from './account.ts';
import { encode, sealBox, encryptRecord } from './protocol.ts';

const contentSecret = new Uint8Array(nacl.randomBytes(32));

function wrapKey(key: Uint8Array, recipientPub: Uint8Array) {
  return encode(Uint8Array.of(0, ...sealBox(key, recipientPub)));
}

test('reports dsh support when the device advertises it', async () => {
  const metaKey = new Uint8Array(nacl.randomBytes(32));
  const contentPub = new Uint8Array(nacl.box.keyPair.fromSecretKey(contentSecret).publicKey);
  const machine = {
    id: 'm1',
    active: true,
    metadata: await encryptRecord({ cliAvailability: { claude: true, codex: true, dsh: true } }, metaKey),
    dataEncryptionKey: wrapKey(metaKey, contentPub),
  };
  expect(await deviceAgentSupport(machine, contentSecret)).toEqual({ claude: true, codex: true, dsh: true });
});

test('treats a missing dsh field as unsupported (older daemon)', async () => {
  const metaKey = new Uint8Array(nacl.randomBytes(32));
  const contentPub = new Uint8Array(nacl.box.keyPair.fromSecretKey(contentSecret).publicKey);
  const machine = {
    id: 'm2',
    active: true,
    metadata: await encryptRecord({ cliAvailability: { claude: true, codex: true } }, metaKey),
    dataEncryptionKey: wrapKey(metaKey, contentPub),
  };
  expect(await deviceAgentSupport(machine, contentSecret)).toEqual({ claude: true, codex: true, dsh: false });
});

test('returns all-false when cliAvailability is absent', async () => {
  const metaKey = new Uint8Array(nacl.randomBytes(32));
  const contentPub = new Uint8Array(nacl.box.keyPair.fromSecretKey(contentSecret).publicKey);
  const machine = {
    id: 'm3',
    active: true,
    metadata: await encryptRecord({ host: 'box' }, metaKey),
    dataEncryptionKey: wrapKey(metaKey, contentPub),
  };
  expect(await deviceAgentSupport(machine, contentSecret)).toEqual({ claude: false, codex: false, dsh: false });
});

test('returns all-false for a legacy (no dataKey) machine rather than throwing', async () => {
  const machine = { id: 'm4', active: true, metadata: 'x', dataEncryptionKey: null };
  expect(await deviceAgentSupport(machine, contentSecret)).toEqual({ claude: false, codex: false, dsh: false });
});