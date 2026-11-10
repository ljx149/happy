import { inTx, Tx } from "@/storage/inTx";
import { db } from "@/storage/db";
import { log } from "@/utils/log";

// The three revocation scopes the spec distinguishes. A revocation is a
// permanent record: clearing the in-memory cache alone is not revocation,
// because a cache miss still verifies the cryptographically signed token.
// These scopes are intentionally narrow so that logging out one browser does
// not revoke the whole account.
export const RevocationScope = {
    session: 'session', // subject = the token's jti (its embedded uuid)
    device: 'device',   // subject = the pairing session id (token extras.session)
    account: 'account', // subject = the account id — kills every token for the account
} as const;

export type RevocationScopeValue = (typeof RevocationScope)[keyof typeof RevocationScope];

export interface RevocationSubject {
    subject: string;
    scope: RevocationScopeValue;
}

// Record a revocation. Idempotent — revoking the same subject twice is a
// no-op, so a client that retries does not create duplicate rows.
export async function recordRevocation(subject: string, scope: RevocationScopeValue): Promise<void> {
    await inTx(async (tx: Tx) => {
        await tx.tokenRevocation.upsert({
            where: { subject },
            create: { subject, scope },
            update: {},
        });
    });
    log({ module: 'auth-revocation' }, `Revoked ${scope} subject=${subject.substring(0, 12)}...`);
}

// True if any revocation applies to this token's identity. The check runs on
// every verification (HTTP and socket alike), so an already-connected socket
// is revoked on its next verified action and a reconnecting client is refused
// at handshake. This is what makes revocation durable across process restarts
// and cache clears — the record lives in the database, not in memory.
export async function isRevoked(
    userId: string,
    jti: string | null,
    session: string | null,
): Promise<boolean> {
    // An account-wide revocation always wins.
    const accountRevoked = await db.tokenRevocation.findUnique({ where: { subject: userId } });
    if (accountRevoked && accountRevoked.scope === RevocationScope.account) {
        return true;
    }
    // A session revocation applies to the specific token (its jti).
    if (jti) {
        const sessionRevoked = await db.tokenRevocation.findUnique({ where: { subject: jti } });
        if (sessionRevoked && sessionRevoked.scope === RevocationScope.session) {
            return true;
        }
    }
    // A device revocation applies to the pairing session that issued the token.
    if (session) {
        const deviceRevoked = await db.tokenRevocation.findUnique({ where: { subject: session } });
        if (deviceRevoked && deviceRevoked.scope === RevocationScope.device) {
            return true;
        }
    }
    return false;
}
