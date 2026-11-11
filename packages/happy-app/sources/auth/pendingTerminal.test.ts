import { afterEach, expect, it, vi } from 'vitest';
import { rememberTerminal, pendingTerminal, forgetTerminal, restoreDestination } from './pendingTerminal';
afterEach(() => vi.unstubAllGlobals());
it('retains a pairing key through restore and clears it on completion', () => {
 const data = new Map<string, string>(); vi.stubGlobal('sessionStorage', { getItem: (k: string) => data.get(k), setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) });
 expect(restoreDestination()).toBe('/'); rememberTerminal('A'.repeat(43)); expect(pendingTerminal()).toBe('A'.repeat(43)); expect(restoreDestination()).toBe('/terminal/connect'); forgetTerminal(); expect(restoreDestination()).toBe('/');
});
it('does not retain malformed input', () => { const setItem = vi.fn(); vi.stubGlobal('sessionStorage', { setItem }); rememberTerminal('bad'); expect(setItem).not.toHaveBeenCalled(); });
