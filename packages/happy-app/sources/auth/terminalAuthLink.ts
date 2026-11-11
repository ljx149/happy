/** Accept the CLI's web link only for the currently selected AgentPort server. */
export function terminalAuthKey(input: string, serverUrl: string): string | null {
    const value = input.trim();
    let key: string | null = null;
    if (value.startsWith('happy://terminal?')) key = value.slice('happy://terminal?'.length);
    else {
        try {
            const url = new URL(value);
            if (url.origin !== new URL(serverUrl).origin || url.pathname !== '/terminal/connect') return null;
            key = new URLSearchParams(url.hash.slice(1)).get('key');
        } catch { return null; }
    }
    return key && /^[A-Za-z0-9_-]{43}$/.test(key) ? key : null;
}
