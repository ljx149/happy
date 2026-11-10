import { expect, test } from 'vitest';
import nacl from 'tweetnacl';
import { deviceAgentSupport, messageText } from './account.ts';
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
test('renders Claude output text blocks and modern session text', () => {
  expect(messageText({ role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { content: [{ type: 'text', text: 'reply one' }, { type: 'text', text: 'reply two' }] } } } })).toBe('reply one\nreply two');
  expect(messageText({ role: 'session', content: { role: 'agent', ev: { t: 'text', text: 'Codex/DSH reply' } } })).toBe('Codex/DSH reply');
});

test('shows runner errors and failed turns instead of a silent chat', () => {
  expect(messageText({ role: 'agent', content: { type: 'event', data: { type: 'message', message: 'Codex error: workspace routing discovery failed' } } })).toContain('workspace routing discovery failed');
  expect(messageText({ role: 'session', content: { ev: { t: 'service', text: 'Missing provider API key' } } })).toBe('Missing provider API key');
  expect(messageText({ role: 'session', content: { ev: { t: 'turn-end', status: 'failed' } } })).toContain('执行失败');
});

 test('control events do not become chat bubbles, while tools and failures remain visible', () => {
  const event = (ev: unknown) => ({ role: 'session', content: { ev } });
  for (const t of ['start', 'stop', 'turn-start', 'tool-call-end']) expect(messageText(event({ t }))).toBe('');
  expect(messageText(event({ t: 'turn-end', status: 'completed' }))).toBe('');
  expect(messageText(event({ t: 'turn-end', status: 'cancelled' }))).toContain('取消');
  expect(messageText(event({ t: 'tool-call-start', name: 'shell', title: '检查目录', description: '列出项目文件' }))).toContain('检查目录');
  expect(messageText(event({ t: 'file', name: 'report.txt' }))).toContain('report.txt');
  expect(messageText(event({ t: 'future-event' }))).toContain('future-event');
 });
