const KEY = 'agentport.pending-terminal';
const valid = (key: string | null): key is string => !!key && /^[A-Za-z0-9_-]{43}$/.test(key);
export function rememberTerminal(key: string): void {
    if (typeof sessionStorage !== 'undefined' && valid(key)) sessionStorage.setItem(KEY, key);
}
export function pendingTerminal(): string | null {
    try {
        const key = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(KEY) : null;
        return valid(key) ? key : null;
    } catch { return null; }
}
export function forgetTerminal(): void {
    try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(KEY); } catch { /* navigation remains usable */ }
}
export function restoreDestination(): '/' | '/terminal/connect' {
    return pendingTerminal() ? '/terminal/connect' : '/';
}
