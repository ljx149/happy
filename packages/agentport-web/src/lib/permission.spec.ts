import { expect, test } from 'vitest';
import { buildPermissionPayload, encodePermissionPayload, permissionRpcMethod, extractPendingRequests } from './permission.ts';
import { encryptRecord, decryptRecord } from './protocol.ts';

const sessionKey = new Uint8Array(32).fill(0x55);

test('buildPermissionPayload encodes an approval', () => {
  expect(buildPermissionPayload({ id: 'call-1', approved: true })).toEqual({
    id: 'call-1',
    approved: true,
  });
});

test('buildPermissionPayload encodes a denial with decision', () => {
  expect(buildPermissionPayload({ id: 'call-2', approved: false, decision: 'denied' })).toEqual({
    id: 'call-2',
    approved: false,
    decision: 'denied',
  });
});

test('permission payload round-trips through session dataKey', async () => {
  const payload = buildPermissionPayload({ id: 'call-3', approved: true });
  const encrypted = await encodePermissionPayload(payload, sessionKey);
  expect(typeof encrypted).toBe('string');
  const back = await decryptRecord(encrypted, sessionKey);
  expect(back).toEqual(payload);
});

test('a wrong key cannot decrypt the permission payload', async () => {
  const payload = buildPermissionPayload({ id: 'call-4', approved: false });
  const encrypted = await encodePermissionPayload(payload, sessionKey);
  await expect(decryptRecord(encrypted, new Uint8Array(32))).rejects.toThrow();
});

test('permission RPC method is the session-scoped name', () => {
  expect(permissionRpcMethod('sess-abc123')).toBe('sess-abc123:permission');
});

test('pending requests extracted from agent state shape', async () => {
  const state = { requests: { 'call-1': { tool: 'bash', arguments: { command: 'ls' }, createdAt: 1 } } };
  const encrypted = await encryptRecord(state, sessionKey);
  const decoded = await decryptRecord(encrypted, sessionKey) as any;
  expect(extractPendingRequests(decoded)).toEqual([
    { id: 'call-1', tool: 'bash', arguments: { command: 'ls' }, createdAt: 1 },
  ]);
});

test('no pending requests returns empty array', async () => {
  const state = { requests: {} };
  const encrypted = await encryptRecord(state, sessionKey);
  const decoded = await decryptRecord(encrypted, sessionKey) as any;
  expect(extractPendingRequests(decoded)).toEqual([]);
});

test('null or undefined agent state returns empty array', () => {
  expect(extractPendingRequests(null)).toEqual([]);
  expect(extractPendingRequests(undefined)).toEqual([]);
});
