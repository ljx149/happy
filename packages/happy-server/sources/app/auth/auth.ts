import * as privacyKit from "privacy-kit";
import { debug, log } from "@/utils/log";
import { isRevoked, recordRevocation, RevocationScope, RevocationScopeValue } from "@/app/auth/revoke";

/** Cache entries expire after 24 hours */
const TOKEN_CACHE_TTL = 24 * 60 * 60 * 1000;
/** Hard cap to prevent unbounded growth */
const MAX_CACHE_SIZE = 10_000;
/** Run cleanup every 10 minutes */
const CLEANUP_INTERVAL = 10 * 60 * 1000;

interface TokenCacheEntry {
    userId: string;
    // The token's stable identifier (its jti). Stored so a cache hit can be
    // cross-checked against the persistent revocation record — a cache entry
    // alone does not keep a token usable, and clearing the cache does not
    // undo a revocation.
    jti: string | null;
    extras?: any;
    cachedAt: number;
}

interface AuthTokens {
    generator: Awaited<ReturnType<typeof privacyKit.createPersistentTokenGenerator>>;
    verifier: Awaited<ReturnType<typeof privacyKit.createPersistentTokenVerifier>>;
    githubVerifier: Awaited<ReturnType<typeof privacyKit.createEphemeralTokenVerifier>>;
    githubGenerator: Awaited<ReturnType<typeof privacyKit.createEphemeralTokenGenerator>>;
}

class AuthModule {
    private tokenCache = new Map<string, TokenCacheEntry>();
    private tokens: AuthTokens | null = null;
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    async init(): Promise<void> {
        if (this.tokens) {
            return; // Already initialized
        }

        log({ module: 'auth' }, 'Initializing auth module...');

        const generator = await privacyKit.createPersistentTokenGenerator({
            service: 'handy',
            seed: process.env.HANDY_MASTER_SECRET!
        });


        const verifier = await privacyKit.createPersistentTokenVerifier({
            service: 'handy',
            publicKey: Uint8Array.from(generator.publicKey)
        });

        const githubGenerator = await privacyKit.createEphemeralTokenGenerator({
            service: 'github-happy',
            seed: process.env.HANDY_MASTER_SECRET!,
            ttl: 5 * 60 * 1000 // 5 minutes
        });

        const githubVerifier = await privacyKit.createEphemeralTokenVerifier({
            service: 'github-happy',
            publicKey: Uint8Array.from(githubGenerator.publicKey),
        });


        this.tokens = { generator, verifier, githubVerifier, githubGenerator };

        // Start periodic cleanup of expired cache entries
        this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL);

        log({ module: 'auth' }, 'Auth module initialized');
    }
    
    async createToken(userId: string, extras?: any): Promise<string> {
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }
        
        const payload: any = { user: userId };
        if (extras) {
            payload.extras = extras;
        }
        
        const token = await this.tokens.generator.new(payload);

        // Capture the token's stable identifier (its jti) so every future
        // verification — cache hit or miss — can be checked against the
        // persistent revocation record.
        const verified = await this.tokens.verifier.verify(token);
        const jti = verified?.uuid ?? null;

        // Cache the token immediately
        this.tokenCache.set(token, {
            userId,
            jti,
            extras,
            cachedAt: Date.now()
        });

        return token;
    }
    
    async verifyToken(token: string): Promise<{ userId: string; jti: string | null; extras?: any } | null> {
        // Check cache first (with TTL)
        const cached = this.tokenCache.get(token);
        if (cached) {
            if (Date.now() - cached.cachedAt > TOKEN_CACHE_TTL) {
                this.tokenCache.delete(token);
            } else {
                // A cache hit is not a pass: the persistent revocation record
                // must still be checked, otherwise a cached token outlives a
                // revocation for up to the 24h TTL.
                const session = (cached.extras?.session as string | null) ?? null;
                if (await isRevoked(cached.userId, cached.jti, session)) {
                    this.tokenCache.delete(token);
                    return null;
                }
                return {
                    userId: cached.userId,
                    jti: cached.jti,
                    extras: cached.extras
                };
            }
        }

        // Cache miss - verify token
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }

        try {
            const verified = await this.tokens.verifier.verify(token);
            if (!verified) {
                return null;
            }

            const userId = verified.user as string;
            const extras = verified.extras;
            const jti = verified.uuid ?? null;
            const session = (extras?.session as string | null) ?? null;

            // Persistent revocation check. This is what makes revocation
            // durable across restarts and cache clears: the record lives in
            // the database, not in memory.
            if (await isRevoked(userId, jti, session)) {
                return null;
            }

            // Evict oldest entries if cache is at capacity
            if (this.tokenCache.size >= MAX_CACHE_SIZE) {
                const oldest = [...this.tokenCache.entries()]
                    .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
                    .slice(0, Math.floor(MAX_CACHE_SIZE * 0.2));
                for (const [key] of oldest) {
                    this.tokenCache.delete(key);
                }
            }

            this.tokenCache.set(token, {
                userId,
                jti,
                extras,
                cachedAt: Date.now()
            });

            return { userId, jti, extras };

        } catch (error) {
            debug({ module: 'auth' }, `auth:token-verification-failed error=${error}`);
            return null;
        }
    }
    
    invalidateUserTokens(userId: string): void {
        // Remove all tokens for a specific user
        // This is expensive but rarely needed
        for (const [token, entry] of this.tokenCache.entries()) {
            if (entry.userId === userId) {
                this.tokenCache.delete(token);
            }
        }
        
        log({ module: 'auth' }, `Invalidated tokens for user: ${userId}`);
    }
    
    invalidateToken(token: string): void {
        this.tokenCache.delete(token);
    }
    
    getCacheStats(): { size: number; oldestEntry: number | null } {
        if (this.tokenCache.size === 0) {
            return { size: 0, oldestEntry: null };
        }
        
        let oldest = Date.now();
        for (const entry of this.tokenCache.values()) {
            if (entry.cachedAt < oldest) {
                oldest = entry.cachedAt;
            }
        }
        
        return {
            size: this.tokenCache.size,
            oldestEntry: oldest
        };
    }
    
    async createGithubToken(userId: string): Promise<string> {
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }
        
        const payload = { user: userId, purpose: 'github-oauth' };
        const token = await this.tokens.githubGenerator.new(payload);
        
        return token;
    }

    async verifyGithubToken(token: string): Promise<{ userId: string } | null> {
        if (!this.tokens) {
            throw new Error('Auth module not initialized');
        }
        
        try {
            const verified = await this.tokens.githubVerifier.verify(token);
            if (!verified) {
                return null;
            }
            
            return { userId: verified.user as string };
        } catch (error) {
            debug({ module: 'auth' }, `auth:github-token-verification-failed error=${error}`);
            return null;
        }
    }

    /** Remove expired entries from the cache */
    cleanup(): void {
        const now = Date.now();
        let removed = 0;
        for (const [token, entry] of this.tokenCache.entries()) {
            if (now - entry.cachedAt > TOKEN_CACHE_TTL) {
                this.tokenCache.delete(token);
                removed++;
            }
        }
        if (removed > 0) {
            log({ module: 'auth' }, `Token cache cleanup: removed ${removed}, remaining ${this.tokenCache.size}`);
        }
    }
}

// Global instance
export const auth = new AuthModule();
