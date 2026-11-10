import { inTx } from "@/storage/inTx";
import { db } from "@/storage/db";
import { AuthRequestStatus, ApprovalResult } from "@/app/auth/terminalAuth";

// The account auth request has the same lifecycle as the terminal request.
// Reuse the same TTL / claim-window semantics so that an approved account
// request cannot mint tokens forever after the device has stopped polling.
const REQUEST_TTL_MS = 5 * 60 * 1000;
const CLAIM_WINDOW_MS = 10 * 1000;

function isExpired(createdAt: Date): boolean {
    return Date.now() - createdAt.getTime() > REQUEST_TTL_MS;
}

function isClaimWindowOver(updatedAt: Date): boolean {
    return Date.now() - updatedAt.getTime() > CLAIM_WINDOW_MS;
}

async function purgeIfExpired(publicKeyHex: string): Promise<boolean> {
    return inTx(async tx => {
        const request = await tx.accountAuthRequest.findUnique({
            where: { publicKey: publicKeyHex },
        });
        if (!request) return false;
        const stale = isExpired(request.createdAt)
            || (!!request.response && isClaimWindowOver(request.updatedAt));
        if (stale) {
            await tx.accountAuthRequest.delete({ where: { id: request.id } });
            return true;
        }
        return false;
    });
}

export async function requestAccountAuth(publicKeyHex: string) {
    await purgeIfExpired(publicKeyHex);
    return inTx(async tx => {
        // No `update` fields: the device re-POSTs this every poll, and
        // refreshing updatedAt on each poll would extend the claim window
        // forever. An empty update object keeps the upsert idempotent without
        // touching timestamps. Mirrors the terminal request's lifecycle.
        return tx.accountAuthRequest.upsert({
            where: { publicKey: publicKeyHex },
            update: {},
            create: { publicKey: publicKeyHex },
        });
    });
}

export async function getAccountAuthStatus(publicKeyHex: string): Promise<AuthRequestStatus> {
    await purgeIfExpired(publicKeyHex);
    const authRequest = await db.accountAuthRequest.findUnique({
        where: { publicKey: publicKeyHex },
    });
    if (!authRequest) {
        return { found: false, response: null, responseAccountId: null, supportsV2: false };
    }
    if (authRequest.response && authRequest.responseAccountId) {
        if (isClaimWindowOver(authRequest.updatedAt)) {
            return { found: false, response: null, responseAccountId: null, supportsV2: false };
        }
        return {
            found: true,
            response: authRequest.response,
            responseAccountId: authRequest.responseAccountId,
            supportsV2: false,
        };
    }
    return { found: true, response: null, responseAccountId: null, supportsV2: false };
}

export async function approveAccountAuth(publicKeyHex: string, response: string, approverAccountId: string): Promise<ApprovalResult> {
    await purgeIfExpired(publicKeyHex);
    return inTx(async tx => {
        const request = await tx.accountAuthRequest.findUnique({
            where: { publicKey: publicKeyHex },
        });
        if (!request) {
            return { claimed: false };
        }
        if (request.response && request.responseAccountId) {
            if (request.responseAccountId === approverAccountId) {
                await tx.accountAuthRequest.update({
                    where: { id: request.id },
                    data: { updatedAt: new Date() },
                });
                return { claimed: true };
            }
            return { claimed: false };
        }
        const updated = await tx.accountAuthRequest.updateMany({
            where: { id: request.id, response: null },
            data: { response, responseAccountId: approverAccountId },
        });
        return { claimed: updated.count === 1 };
    });
}
