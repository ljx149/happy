import { expect, test } from 'vitest';
import {
  buildSpawnParams,
  encodeSpawnParams,
  decodeSpawnResult,
  interpretSpawnResult,
  spawnRpcMethod,
} from './spawn.ts';
import { encryptRecord, decryptRecord } from './protocol.ts';

const machineKey = new Uint8Array(32).fill(0x7a);

test('buildSpawnParams shapes the daemon payload', () => {
  const params = buildSpawnParams({ directory: '/repo', agent: 'codex' });
  expect(params).toEqual({
    directory: '/repo',
    agent: 'codex',
    approvedNewDirectoryCreation: true,
  });
});

test('buildSpawnParams carries explicit mode/model and directory approval', () => {
  const params = buildSpawnParams({
    directory: '/repo',
    agent: 'claude',
    approvedNewDirectoryCreation: false,
    permissionMode: 'yolo',
    modelMode: 'opus',
  });
  expect(params).toEqual({
    directory: '/repo',
    agent: 'claude',
    approvedNewDirectoryCreation: false,
    permissionMode: 'yolo',
    modelMode: 'opus',
  });
});

test('spawn params round-trip through the machine dataKey as base64', async () => {
  const params = buildSpawnParams({ directory: '/repo', agent: 'dsh' });
  const encrypted = await encodeSpawnParams(params, machineKey);
  expect(typeof encrypted).toBe('string');
  const back = await decodeSpawnResult(encrypted, machineKey);
  expect(back).toEqual(params);
});

test('a wrong machine key cannot decrypt the spawn params', async () => {
  const params = buildSpawnParams({ directory: '/repo', agent: 'codex' });
  const encrypted = await encodeSpawnParams(params, machineKey);
  await expect(decryptRecord(encrypted, new Uint8Array(32))).rejects.toThrow();
});

test('interprets a successful spawn result', () => {
  expect(interpretSpawnResult({ type: 'success', sessionId: 'sess-1' })).toEqual({
    kind: 'success',
    sessionId: 'sess-1',
  });
});

test('interprets a directory-creation approval request', () => {
  expect(interpretSpawnResult({ type: 'requestToApproveDirectoryCreation', directory: '/new' })).toEqual({
    kind: 'directory-approval',
    directory: '/new',
  });
});

test('interprets an error result from the daemon', () => {
  expect(interpretSpawnResult({ error: 'Directory is required' })).toEqual({
    kind: 'error',
    message: 'Directory is required',
  });
});

test('interprets an unrecognised result as unknown rather than silently succeeding', () => {
  expect(interpretSpawnResult({ bogus: true })).toEqual({ kind: 'unknown', raw: { bogus: true } });
  expect(interpretSpawnResult(null)).toEqual({ kind: 'unknown', raw: null });
});

test('the RPC method is the machine-scoped spawn-happy-session name', () => {
  expect(spawnRpcMethod('cm9abc123')).toBe('cm9abc123:spawn-happy-session');
});

test('shows daemon errorMessage instead of treating a known launch failure as unknown', () => {
  expect(interpretSpawnResult({ type: 'error', errorMessage: 'Agent is not installed' })).toEqual({ kind: 'error', message: 'Agent is not installed' });
});
