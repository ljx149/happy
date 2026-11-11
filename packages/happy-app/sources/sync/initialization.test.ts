import { expect, it, vi } from 'vitest';
import { singleInitialization } from './initialization';
it('awaits the same in-progress initialization for concurrent login attempts', async () => {
 const once = singleInitialization(); let finish!: () => void;
 const init = vi.fn(() => new Promise<void>(r => { finish = r; }));
 const a = once(init), b = once(init); expect(a).toBe(b);
 await vi.waitFor(() => expect(init).toHaveBeenCalledOnce()); finish(); await a;
 await once(init); expect(init).toHaveBeenCalledOnce();
});
it('never reports success after partial initialization failed', async () => {
 const once = singleInitialization(); const init = vi.fn().mockRejectedValue(new Error('encryption initialization failed'));
 await expect(once(init)).rejects.toThrow('encryption initialization failed');
 await expect(once(init)).rejects.toThrow('encryption initialization failed'); expect(init).toHaveBeenCalledOnce();
});
