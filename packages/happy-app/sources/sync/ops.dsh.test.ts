import { beforeEach, expect, it, vi } from 'vitest';
const { rpc, state } = vi.hoisted(() => ({ rpc: vi.fn(), state: { machines: {} as Record<string, any> } }));
vi.mock('./apiSocket', () => ({ apiSocket: { machineRPC: rpc } }));
vi.mock('./sync', () => ({ sync: {} }));
vi.mock('./storage', () => ({ storage: { getState: () => state } }));
import { machineSpawnNewSession } from './ops';
beforeEach(() => { vi.clearAllMocks(); state.machines = {}; rpc.mockResolvedValue({ type: 'success', sessionId: 'new' }); });
it.each([undefined, '1.2.11', 'invalid'])('blocks all DSH creation entry points with unsupported daemon %s', version => {
  state.machines.m = { metadata: { happyCliVersion: version } };
  return machineSpawnNewSession({ machineId: 'm', directory: '/tmp', agent: 'dsh' }).then(result => {
    expect(result).toMatchObject({ type: 'error', errorMessage: expect.stringContaining('1.2.12') });
    expect(rpc).not.toHaveBeenCalled();
  });
});
it('lets a supported daemon enforce its current DSH configuration without forcing a model', async () => {
  state.machines.m = { metadata: { happyCliVersion: '1.2.12' } };
  await machineSpawnNewSession({ machineId: 'm', directory: '/tmp', agent: 'dsh', modelMode: 'other/model' });
  expect(rpc).toHaveBeenCalledWith('m', 'spawn-happy-session', expect.objectContaining({ agent: 'dsh', modelMode: 'other/model' }));
});
it('does not impose the DSH version requirement on Codex', async () => {
  await machineSpawnNewSession({ machineId: 'm', directory: '/tmp', agent: 'codex' });
  expect(rpc).toHaveBeenCalled();
});

it('preserves the encrypted daemon configuration refusal', async () => {
  state.machines.m = { metadata: { happyCliVersion: '1.2.12' } };
  rpc.mockResolvedValue({ error: 'Configure xmodels/Xcoder1.0 first' });
  expect(await machineSpawnNewSession({ machineId: 'm', directory: '/tmp', agent: 'dsh' })).toEqual({ type: 'error', errorMessage: 'Configure xmodels/Xcoder1.0 first' });
});
