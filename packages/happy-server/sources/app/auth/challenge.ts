import * as privacyKit from "privacy-kit";
import { inTx, Tx } from "@/storage/inTx";
import { db } from "@/storage/db";
import { log } from "@/utils/log";

// TTL for an issued-but-unused challenge. A client has this much time to
// sign and submit the challenge before it expires and must request a fresh
// one. 60s is short enough to bound the replay window but long enough for a
// user to copy a URL and paste it into a terminal.
const CHALLENGE_TTL_MS = 60 * 1000;

// Purpose tag so a challenge issued for one exchange cannot be replayed
// against a different purpose (e.g. a future device-pairing flow).
const PURPOSE = "auth-exchange";

export interface IssuedChallenge {
    challenge: string;
    claimToken: string;
}

// The persistent record stored under the claimToken in the shared
// RepeatKey table. It binds the issued challenge bytes to an identity and a
// purpose, so a signature captured from one exchange cannot be replayed
// against another identity or a different exchange flow.
interface ChallengeRecord {
    challengeB64: string;
    publicKey: string;
    purpose: string;
    issuedAt: number;
}

// Issue a fresh server-side challenge for an identity. The challenge is a
// random 32-byte value; the claimToken is an opaque reference the client
// presents back at exchange time. Both live in the shared persistent layer
// (RepeatKey) keyed by claimToken, so the exchange survives process restarts
// and is atomic across processes.
export async function issueChallenge(publicKeyHex: string): Promise<IssuedChallenge> {
    const challenge = privacyKit.encodeBase64(privacyKit.randomBytes(32));
    const claimToken = privacyKit.crypto.randomKey("challenge-", 48);

    const record: ChallengeRecord = {
        challengeB64: challenge,
        publicKey: publicKeyHex,
        purpose: PURPOSE,
        issuedAt: Date.now(),
    };

    await inTx(async (tx: Tx) => {
        await tx.repeatKey.upsert({
            where: { key: claimToken },
            create: { key: claimToken, value: JSON.stringify(record), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
            update: { value: JSON.stringify(record), expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
        });
    });

    log({ module: 'auth-challenge' }, `Challenge issued for publicKey ${publicKeyHex.substring(0, 12)}...`);
    return { challenge, claimToken };
}

export type ExchangeResult =
    | { ok: true }
    | { ok: false; reason: 'expired' | 'unknown' | 'mismatch' | 'invalid_signature' | 'already_consumed' };

// Verify a submitted challenge and atomically consume it. The claimToken
// references a RepeatKey row holding the issued challenge and the bound
// identity. Only the first exchange succeeds; concurrent duplicates and any
// replay after consumption fail with a specific reason.
export async function exchangeChallenge(
    claimToken: string,
    publicKeyHex: string,
    signature: Uint8Array,
): Promise<ExchangeResult> {
    const tweetnacl = (await import("tweetnacl")).default;

    return inTx(async (tx: Tx) => {
        const row = await tx.repeatKey.findUnique({ where: { key: claimToken } });
        if (!row) {
            // No such claimToken — either never issued or already consumed.
            return { ok: false, reason: 'unknown' as const };
        }
        if (row.expiresAt < new Date()) {
            // Expired: clean up and reject.
            await tx.repeatKey.delete({ where: { key: claimToken } });
            return { ok: false, reason: 'expired' as const };
        }

        let record: ChallengeRecord;
        try {
            record = JSON.parse(row.value);
        } catch {
            await tx.repeatKey.delete({ where: { key: claimToken } });
            return { ok: false, reason: 'unknown' as const };
        }

        if (record.publicKey !== publicKeyHex || record.purpose !== PURPOSE) {
            return { ok: false, reason: 'mismatch' as const };
        }

        // Verify the signature over the exact challenge bytes that were issued.
        // Because the challenge is a server-generated random value stored only in
        // this row, a signature from a previous exchange cannot be replayed — the
        // row it signed is already gone (deleted on first consumption).
        const issuedChallenge = privacyKit.decodeBase64(record.challengeB64);
        const publicKeyBytes = privacyKit.decodeHex(publicKeyHex);
        const isValid = tweetnacl.sign.detached.verify(issuedChallenge, signature, publicKeyBytes);
        if (!isValid) {
            return { ok: false, reason: 'invalid_signature' as const };
        }

        // Atomic consumption. The repeatKey row is the claim: deleteMany under
        // the transaction's row lock guarantees exactly one concurrent
        // exchange succeeds. A replay after consumption sees count === 0.
        const deleted = await tx.repeatKey.deleteMany({ where: { key: claimToken } });
        if (deleted.count !== 1) {
            return { ok: false, reason: 'already_consumed' as const };
        }

        log({ module: 'auth-challenge' }, `Challenge consumed for publicKey ${publicKeyHex.substring(0, 12)}...`);
        return { ok: true };
    });
}
