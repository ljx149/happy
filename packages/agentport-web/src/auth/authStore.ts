import { getToken, verifyToken, AuthError, AuthServerConfig } from './authClient';
import { format, normalize } from './backup';
import {
    readStoredCredentials, writeStoredCredentials, clearStoredCredentials,
    deriveKeyFromPhrase, encryptSecret, decryptSecret,
} from './credentials';

export type AuthState =
    | { phase: 'initializing' }
    | { phase: 'signedOut' }
    | { phase: 'authenticating' }
    | { phase: 'signedIn'; token: string; secretBase64Url: string; serverId?: string }
    | { phase: 'error'; message: string; retryable: boolean };

/**
 * Holds the in-memory identity for the current tab. The token and secret
 * never leave this object unless explicitly persisted via "remember this
 * browser". A refresh without "remember" loses the session.
 */
export class AuthStore {
    private state: AuthState = { phase: 'initializing' };
    private listeners = new Set<(s: AuthState) => void>();
    private inFlight: Promise<unknown> | null = null;

    constructor(private readonly cfg: AuthServerConfig) {}

    getState(): AuthState {
        return this.state;
    }

    subscribe(fn: (s: AuthState) => void): () => void {
        this.listeners.add(fn);
        fn(this.state);
        return () => this.listeners.delete(fn);
    }

    private setState(s: AuthState) {
        this.state = s;
        for (const fn of this.listeners) fn(s);
    }

    /**
     * On startup: check IndexedDB for a remembered identity. If present,
     * prompt for the unlock phrase (the caller handles that UI); the store
     * itself only reports that a remembered identity exists.
     */
    async startup(): Promise<{ remembered: boolean }> {
        const record = await readStoredCredentials();
        if (record) {
            // We have a remembered identity but need the phrase to unlock.
            // The caller will show the restore screen with a "unlock" button.
            this.setState({ phase: 'signedOut' });
            return { remembered: true };
        }
        this.setState({ phase: 'signedOut' });
        return { remembered: false };
    }

    /**
     * Create a new account: generate a random 32-byte secret, sign a
     * challenge, and POST /v1/auth. On success the identity is in memory
     * only — the caller must show the backup step before the user proceeds.
     */
    async createAccount(): Promise<{ secretBase64Url: string; formattedBackup: string; token: string }> {
        if (this.inFlight) throw new Error('Auth already in progress');
        const op = (async () => {
            this.setState({ phase: 'authenticating' });
            const secret = crypto.getRandomValues(new Uint8Array(32));
            const secretBase64Url = btoa(String.fromCharCode(...secret)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            try {
                const token = await getToken(secret, this.cfg);
                const ok = await verifyToken(token, this.cfg);
                if (!ok) throw new AuthError('Token not accepted by protected endpoint', 0, 'unknown');
                this.setState({ phase: 'signedIn', token, secretBase64Url });
                return { secretBase64Url, formattedBackup: format(secretBase64Url), token };
            } catch (e) {
                const msg = e instanceof AuthError ? e.message : `Auth failed: ${e instanceof Error ? e.message : String(e)}`;
                this.setState({ phase: 'error', message: msg, retryable: e instanceof AuthError && e.kind === 'network' });
                throw e;
            } finally {
                this.inFlight = null;
            }
        })();
        this.inFlight = op;
        return op;
    }

    /**
     * Restore from a typed secret. Accepts either the base64url form or the
     * formatted Base32 form; normalizes to base64url and signs a challenge.
     * The server upserts by publicKey, so an unknown secret creates a new
     * empty account — the success message must say "logged in to the account
     * this key corresponds to", not "restored your account".
     */
    async restore(rawInput: string): Promise<{ token: string }> {
        if (this.inFlight) throw new Error('Auth already in progress');
        const op = (async () => {
            this.setState({ phase: 'authenticating' });
            let secretBase64Url: string;
            try {
                secretBase64Url = normalize(rawInput);
            } catch {
                this.setState({ phase: 'error', message: 'Invalid recovery key format', retryable: false });
                throw new Error('Invalid recovery key format');
            }
            const secret = Uint8Array.from(atob(secretBase64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - secretBase64Url.length % 4) % 4)), c => c.charCodeAt(0));
            try {
                const token = await getToken(secret, this.cfg);
                const ok = await verifyToken(token, this.cfg);
                if (!ok) throw new AuthError('Token not accepted by protected endpoint', 0, 'unknown');
                this.setState({ phase: 'signedIn', token, secretBase64Url });
                return { token };
            } catch (e) {
                const msg = e instanceof AuthError ? e.message : `Auth failed: ${e instanceof Error ? e.message : String(e)}`;
                this.setState({ phase: 'error', message: msg, retryable: e instanceof AuthError && e.kind === 'network' });
                throw e;
            } finally {
                this.inFlight = null;
            }
        })();
        this.inFlight = op;
        return op;
    }

    /**
     * Unlock a remembered identity using the user's phrase.
     */
    async unlockRemembered(phrase: string): Promise<void> {
        if (this.inFlight) throw new Error('Auth already in progress');
        const op = (async () => {
            this.setState({ phase: 'authenticating' });
            const record = await readStoredCredentials();
            if (!record) throw new Error('No remembered identity');
            const salt = Uint8Array.from(atob(record.salt), c => c.charCodeAt(0));
            const key = await deriveKeyFromPhrase(phrase, salt);
            let secretBase64Url: string;
            try {
                secretBase64Url = await decryptSecret(record.salt, record.ciphertext, key);
            } catch {
                this.setState({ phase: 'error', message: 'Wrong unlock phrase', retryable: true });
                throw new Error('Wrong unlock phrase');
            }
            const secret = Uint8Array.from(atob(secretBase64Url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - secretBase64Url.length % 4) % 4)), c => c.charCodeAt(0));
            try {
                const token = await getToken(secret, this.cfg);
                const ok = await verifyToken(token, this.cfg);
                if (!ok) throw new AuthError('Token not accepted by protected endpoint', 0, 'unknown');
                this.setState({ phase: 'signedIn', token, secretBase64Url });
            } catch (e) {
                const msg = e instanceof AuthError ? e.message : `Auth failed: ${e instanceof Error ? e.message : String(e)}`;
                this.setState({ phase: 'error', message: msg, retryable: e instanceof AuthError && e.kind === 'network' });
                throw e;
            } finally {
                this.inFlight = null;
            }
        })();
        this.inFlight = op;
        return op;
    }

    /**
     * Persist the current identity to IndexedDB, keyed from a phrase.
     * Only called when the user explicitly opts into "remember this browser".
     */
    async remember(phrase: string): Promise<void> {
        const s = this.state;
        if (s.phase !== 'signedIn') throw new Error('Not signed in');
        const salt = crypto.getRandomValues(new Uint8Array(12));
        const key = await deriveKeyFromPhrase(phrase, salt);
        const { salt: saltB64, ciphertext } = await encryptSecret(s.secretBase64Url, key);
        await writeStoredCredentials({ version: 1, salt: saltB64, ciphertext, origin: location.origin });
    }

    /**
     * Local logout: clear in-memory state and the IndexedDB record. This is
     * NOT server-side token revocation — the token remains valid until its
     * 24h cache TTL expires. The UI must not claim "revoked server access".
     */
    async logout(): Promise<void> {
        await clearStoredCredentials();
        this.setState({ phase: 'signedOut' });
    }

    /** Handle a 401 from a protected endpoint: drop back to signedOut. */
    handleUnauthorized(): void {
        this.setState({ phase: 'signedOut' });
    }
}
