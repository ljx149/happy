import { expect, it, vi } from 'vitest';
import { createTerminalAccountFlow } from './terminalAccount';
const credentials = { token: 'test-token', secret: 'test-secret' };
it('reuses an authenticated account without creating or logging in', async () => {
    const deps = { create: vi.fn(), login: vi.fn() };
    expect(await createTerminalAccountFlow(deps)(credentials)).toBe(credentials);
    expect(deps.create).not.toHaveBeenCalled(); expect(deps.login).not.toHaveBeenCalled();
});
it('does not return credentials for approval until persistence/login completes', async () => {
    let complete!: () => void;
    const deps = { create: vi.fn().mockResolvedValue(credentials), login: vi.fn(() => new Promise<void>(r => { complete = r; })) };
    const flow = createTerminalAccountFlow(deps); let finished = false;
    const first = flow(null); first.then(() => { finished = true; }); const second = flow(null);
    await vi.waitFor(() => expect(deps.login).toHaveBeenCalledOnce());
    expect(first).toBe(second); expect(finished).toBe(false);
    complete(); expect(await first).toBe(credentials); expect(deps.create).toHaveBeenCalledOnce();
});
it('fails closed on storage/login failure and retries the same identity', async () => {
    const deps = { create: vi.fn().mockResolvedValue(credentials), login: vi.fn().mockRejectedValueOnce(new Error('storage blocked')).mockResolvedValue(undefined) };
    const flow = createTerminalAccountFlow(deps);
    await expect(flow(null)).rejects.toThrow('storage blocked');
    expect(await flow(null)).toBe(credentials); expect(deps.create).toHaveBeenCalledOnce(); expect(deps.login).toHaveBeenCalledTimes(2);
});
it('does not log in if account creation fails', async () => {
    const deps = { create: vi.fn().mockRejectedValue(new Error('offline')), login: vi.fn() };
    await expect(createTerminalAccountFlow(deps)(null)).rejects.toThrow('offline'); expect(deps.login).not.toHaveBeenCalled();
});
