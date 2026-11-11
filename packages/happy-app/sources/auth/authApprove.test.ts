import { beforeEach, expect, it, vi } from 'vitest';
const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('axios', () => ({ default: { get, post } }));
vi.mock('@/sync/serverConfig', () => ({ getServerUrl: () => 'https://agent.test' }));
vi.mock('@/sync/apiSocket', () => ({ getHappyClientId: () => 'test' }));
import { authApprove } from './authApprove';
beforeEach(() => { vi.clearAllMocks(); post.mockResolvedValue({ data: { success: true } }); });
const approve = () => authApprove('test-token', new Uint8Array(32), new Uint8Array(32), new Uint8Array(33));
it('refuses expired requests rather than reporting success', async () => {
 get.mockResolvedValue({ data: { status: 'not_found', supportsV2: false } });
 await expect(approve()).rejects.toThrow('已失效'); expect(post).not.toHaveBeenCalled();
});
it.each(['pending', 'authorized'])('verifies account ownership with server for %s', async status => {
 get.mockResolvedValue({ data: { status, supportsV2: true } });
 await approve(); expect(post).toHaveBeenCalledOnce();
 expect(post.mock.calls[0][2].headers.Authorization).toBe('Bearer test-token');
});
it('propagates a different-account claim conflict', async () => {
 get.mockResolvedValue({ data: { status: 'authorized', supportsV2: true } }); post.mockRejectedValue(new Error('Request already claimed'));
 await expect(approve()).rejects.toThrow('already claimed');
});
