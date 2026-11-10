import { encodeBase64, decodeBase64, authChallenge } from './crypto';

export interface AuthServerConfig {
    /** Base URL of the Happy server, e.g. https://agent.xcodex.vip. */
    baseUrl: string;
}

export interface AuthResponse {
    success: boolean;
    token: string;
}

export interface TerminalAuthRequestState {
    state: 'requested' | 'authorized';
    token?: string;
    response?: string;
}

export interface TerminalAuthStatus {
    status: 'not_found' | 'pending' | 'authorized';
    supportsV2: boolean;
}

export class AuthError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly kind: 'network' | 'invalid_signature' | 'invalid_key' | 'not_found' | 'unknown',
    ) {
        super(message);
        this.name = 'AuthError';
    }
}

function classify(status: number, body: unknown): AuthError['kind'] {
    if (status === 401) {
        const text = typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body);
        if (text.includes('Invalid signature')) return 'invalid_signature';
        if (text.includes('Invalid public key')) return 'invalid_key';
        return 'invalid_signature';
    }
    if (status === 404) return 'not_found';
    return 'unknown';
}

/**
 * POST /v1/auth — exchange a signed challenge for a token.
 * Creates the account on first use (the server upserts by publicKey).
 */
export async function getToken(secret: Uint8Array, cfg: AuthServerConfig): Promise<string> {
    const { challenge, publicKey, signature } = authChallenge(secret);
    let response: Response;
    try {
        response = await fetch(`${cfg.baseUrl}/v1/auth`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                challenge: encodeBase64(challenge),
                publicKey: encodeBase64(publicKey),
                signature: encodeBase64(signature),
            }),
        });
    } catch (e) {
        throw new AuthError(`Network error: ${e instanceof Error ? e.message : String(e)}`, 0, 'network');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new AuthError(`Auth failed: ${response.status}`, response.status, classify(response.status, body));
    }
    const data = (await response.json()) as AuthResponse;
    if (!data.success || !data.token) {
        throw new AuthError('Server returned no token', response.status, 'unknown');
    }
    return data.token;
}

/**
 * POST /v1/auth/request — create or fetch a terminal auth request.
 * The CLI calls this with a fresh ephemeral public key and polls until
 * state === 'authorized'.
 */
export async function requestTerminalAuth(publicKey: Uint8Array, cfg: AuthServerConfig): Promise<TerminalAuthRequestState> {
    let response: Response;
    try {
        response = await fetch(`${cfg.baseUrl}/v1/auth/request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicKey: encodeBase64(publicKey), supportsV2: true }),
        });
    } catch (e) {
        throw new AuthError(`Network error: ${e instanceof Error ? e.message : String(e)}`, 0, 'network');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new AuthError(`Auth request failed: ${response.status}`, response.status, classify(response.status, body));
    }
    return (await response.json()) as TerminalAuthRequestState;
}

/**
 * GET /v1/auth/request/status — poll a terminal auth request.
 */
export async function getTerminalAuthStatus(publicKey: Uint8Array, cfg: AuthServerConfig): Promise<TerminalAuthStatus> {
    let response: Response;
    try {
        response = await fetch(
            `${cfg.baseUrl}/v1/auth/request/status?publicKey=${encodeURIComponent(encodeBase64(publicKey))}`,
            { method: 'GET' },
        );
    } catch (e) {
        throw new AuthError(`Network error: ${e instanceof Error ? e.message : String(e)}`, 0, 'network');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new AuthError(`Status failed: ${response.status}`, response.status, classify(response.status, body));
    }
    return (await response.json()) as TerminalAuthStatus;
}

/**
 * POST /v1/auth/response — the approver (web) hands the CLI its sealed answer.
 * Must be called with a valid token.
 */
export async function approveTerminalAuth(token: string, publicKey: Uint8Array, responseBytes: Uint8Array, cfg: AuthServerConfig): Promise<void> {
    let response: Response;
    try {
        response = await fetch(`${cfg.baseUrl}/v1/auth/response`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
                response: encodeBase64(responseBytes),
                publicKey: encodeBase64(publicKey),
            }),
        });
    } catch (e) {
        throw new AuthError(`Network error: ${e instanceof Error ? e.message : String(e)}`, 0, 'network');
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new AuthError(`Approve failed: ${response.status}`, response.status, classify(response.status, body));
    }
    const data = await response.json().catch(() => null);
    if (data && typeof data === 'object' && (data as { success?: boolean }).success === false) {
        throw new AuthError('Approve returned success:false', response.status, 'unknown');
    }
}

/**
 * GET a protected endpoint to verify a token is usable.
 * Returns true if the server answers 2xx.
 */
export async function verifyToken(token: string, cfg: AuthServerConfig): Promise<boolean> {
    try {
        const response = await fetch(`${cfg.baseUrl}/v1/machines`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        return response.ok;
    } catch {
        return false;
    }
}
