import { inTx, Tx } from "@/storage/inTx";
import { db } from "@/storage/db";

// An unclaimed auth request lives this long. The CLI re-POSTs /v1/auth/request
// roughly every second, so the request must stay claimable across the polling
// interval even when no poll lands exactly inside the TTL. A request that is
// created and never claimed, or approved and never claimed, expires here.
const REQUEST_TTL_MS = 5 * 60 * 1000;

// After a response is written, the terminal keeps polling /v1/auth/request to
// pick it up. The claim window is how long the stored response is offered
// instead of being re-created. It must cover at least one polling interval.
// Once it lapses, the stored response is no longer handed out — this is what
// stops an old request from minting tokens forever after it is approved.
const CLAIM_WINDOW_MS = 10 * 1000;

export interface AuthRequestStatus {
    found: boolean;
    response: string | null;
    responseAccountId: string | null;
    supportsV2: boolean;
}

export type AuthRequestError =
    | { kind: 'expired' }
    | { kind: 'conflict' }
    | { kind: 'not_found' };

export interface ApprovalResult {
    claimed: boolean;
}

function isExpired(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() > REQUEST_TTL_MS;
}

function isClaimWindowOver(updatedAt: Date): boolean {
    return Date.now() - updatedAt.getTime() > CLAIM_WINDOW_MS;
}

// Returns the terminal auth request if it is still present and usable,
// deleting it when it is. This is called from every entry point — create,
// poll, status, approve — so an expired request cannot mint a token no matter
// which path it is reached through.
async function purgeIfExpired(publicKeyHex: string): Promise<boolean> {
    return inTx(async tx => {
        const request = await tx.terminalAuthRequest.findUnique({
            where: { publicKey: publicKeyHex },
        });
        if (!request) return false;

        const stale = isExpired(request.createdAt)
            || (!!request.response && isClaimWindowOver(request.updatedAt));
        if (stale) {
            await tx.terminalAuthRequest.delete({ where: { id: request.id } });
            return true;
        }
        return false;
    });
}

// Create or refresh the terminal auth request for a device. Idempotent: the
// device re-POSTs this every poll, so an existing request is simply touched,
// never replaced with a new response. If a prior response is still inside its
// claim window it is returned unchanged so a client that missed it can pick it
// up again.
export async function requestTerminalAuth(publicKeyHex: string, supportsV2: boolean) {
    await purgeIfExpired(publicKeyHex);
    return inTx(async tx => {
        // No `update` fields: the device re-POSTs this every poll, and
        // refreshing updatedAt on each poll would extend the claim window
        // forever (the request would never lapse even if the device never
        // claims). An empty update object keeps the upsert idempotent without
        // touching timestamps. The claim window is anchored to the last
        // approval, which is exactly what the brief asks for — a short,
        // bounded, one-time-ish claim rather than a permanent token minting
        // channel.
        const answer = await tx.terminalAuthRequest.upsert({
            where: { publicKey: publicKeyHex },
            update: {},
            create: { publicKey: publicKeyHex, supportsV2 },
        });
        return answer;
    });
}

// Read-only status check. Expiry is enforced here so a request that has lapsed
// reports not_found rather than leaking supportsV2 of a dead request.
export async function getTerminalAuthStatus(publicKeyHex: string): Promise<AuthRequestStatus> {
    await purgeIfExpired(publicKeyHex);
    const authRequest = await db.terminalAuthRequest.findUnique({
        where: { publicKey: publicKeyHex },
    });
    if (!authRequest) {
        return { found: false, response: null, responseAccountId: null, supportsV2: false };
    }
    if (authRequest.response && authRequest.responseAccountId) {
        if (isClaimWindowOver(authRequest.updatedAt)) {
            return { found: false, response: null, responseAccountId: null, supportsV2: false };
        }
        // Return the stored supportsV2, not a hard-coded false. A client that
        // opted into V2 at create time must see V2 here too, otherwise the
        // approver and the device disagree on the protocol and the device
        // silently falls back to a degraded path.
        return {
            found: true,
            response: authRequest.response,
            responseAccountId: authRequest.responseAccountId,
            supportsV2: authRequest.supportsV2,
        };
    }
    return { found: true, response: null, responseAccountId: null, supportsV2: authRequest.supportsV2 };
}

// Atomically approve an auth request. The conditional updateMany guarantees
// that exactly one of two concurrent approvers writes the response: the
// first wins and claims the request, the second sees affectedRows === 0 and
// reports the conflict. Repeated approval by the same account is idempotent —
// it re-claims the same request without error.
export async function approveTerminalAuth(publicKeyHex: string, response: string, approverAccountId: string): Promise<ApprovalResult> {
    await purgeIfExpired(publicKeyHex);
    return inTx(async tx => {
        const request = await tx.terminalAuthRequest.findUnique({
            where: { publicKey: publicKeyHex },
        });
        if (!request) {
            return { claimed: false };
        }
        if (request.response && request.responseAccountId) {
            if (request.responseAccountId === approverAccountId) {
                // Same approver re-submitting: idempotent, refresh the window.
                await tx.terminalAuthRequest.update({
                    where: { id: request.id },
                    data: { updatedAt: new Date() },
                });
                return { claimed: true };
            }
            // A different account already claimed it.
            return { claimed: false };
        }

        const updated = await tx.terminalAuthRequest.updateMany({
            where: { id: request.id, response: null },
            data: { response, responseAccountId: approverAccountId },
        });
        return { claimed: updated.count === 1 };
    });
}
