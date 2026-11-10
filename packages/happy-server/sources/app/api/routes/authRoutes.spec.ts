import fastify from "fastify";
import { serializerCompiler, validatorCompiler, ZodTypeProvider } from "fastify-type-provider-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fastify } from "../types";
import tweetnacl from "tweetnacl";
import * as privacyKit from "privacy-kit";

// Route-level tests: exercise authRoutes through a real Fastify app with the
// db / auth / challenge / revoke / eventRouter boundaries mocked. This proves
// the HTTP contract (4xx for malformed input, replay refusal, revocation
// scope routing) without a live database. Concurrency and expiry are covered
// by terminalAuth.spec.ts against a real PGlite.

// privacy-kit's Bytes type is Uint8Array<ArrayBuffer>; tweetnacl returns
// Uint8Array<ArrayBufferLike>, which is not assignable. This helper copies
// into a fresh ArrayBuffer-backed array.
function toBytes(buf: Uint8Array): privacyKit.Bytes {
    const out = new Uint8Array(buf.length);
    out.set(buf);
    return out;
}

const state = vi.hoisted(() => ({
    accounts: [] as Array<{ id: string; publicKey: string }>,
    exchange: null as null | { ok: boolean; reason?: string },
    issued: { challenge: Buffer.alloc(32).toString("base64"), claimToken: "claim-abc" },
    revocations: [] as Array<{ subject: string; scope: string }>,
    disconnected: 0,
}));

vi.mock("@/storage/db", () => ({
    db: {
        account: {
            upsert: vi.fn(async ({ where, create, update }: any) => {
                const existing = state.accounts.find(a => a.publicKey === where.publicKey);
                if (existing) return existing;
                const created = { id: `acct-${where.publicKey.slice(0, 8)}`, publicKey: where.publicKey, ...create, ...update };
                state.accounts.push(created);
                return created;
            }),
        },
    },
}));

vi.mock("@/app/auth/auth", () => ({
    auth: {
        createToken: vi.fn(async (userId: string) => `tok-${userId}`),
        invalidateUserTokens: vi.fn(),
    },
}));

vi.mock("@/app/auth/challenge", () => ({
    issueChallenge: vi.fn(async () => state.issued),
    exchangeChallenge: vi.fn(async () => state.exchange ?? { ok: false, reason: "unknown" }),
}));

vi.mock("@/app/auth/revoke", () => ({
    recordRevocation: vi.fn(async (subject: string, scope: string) => {
        state.revocations.push({ subject, scope });
    }),
    RevocationScope: { session: "session", device: "device", account: "account" },
}));

vi.mock("@/app/events/eventRouter", () => ({
    eventRouter: {
        disconnectRevoked: vi.fn(async () => state.disconnected++),
    },
}));

import { authRoutes } from "./authRoutes";

async function buildApp(): Promise<Fastify> {
    const app = fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    const typed = app.withTypeProvider<ZodTypeProvider>() as unknown as Fastify;
    typed.decorate("authenticate", async (request: any) => {
        request.userId = "acct-1";
        request.jti = "jti-1";
        request.session = "pair-1";
    });
    authRoutes(typed);
    await typed.ready();
    return typed;
}

function sign(challenge: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return tweetnacl.sign.detached(challenge, secretKey);
}

beforeEach(() => {
    state.accounts = [];
    state.exchange = null;
    state.issued = { challenge: Buffer.alloc(32).toString("base64"), claimToken: "claim-abc" };
    state.revocations = [];
    state.disconnected = 0;
});

afterEach(() => {
    vi.clearAllMocks();
});

describe("POST /v1/auth — legacy signature exchange", () => {
    it("returns 400 for malformed base64 input instead of a 500", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: { publicKey: "!!not-base64!!", challenge: privacyKit.encodeBase64(Buffer.alloc(32)), signature: privacyKit.encodeBase64(Buffer.alloc(64)) },
        });
        expect(res.statusCode).toBe(400);
    });

    it("returns 400 for an oversized payload", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: { publicKey: "A".repeat(5000), challenge: "AAAA", signature: "AAAA" },
        });
        expect(res.statusCode).toBe(400);
    });

    it("returns 401 for a bad signature over the challenge", async () => {
        const app = await buildApp();
        const kp = tweetnacl.sign.keyPair();
        const challenge = new Uint8Array(32);
        const badSig = sign(challenge, tweetnacl.sign.keyPair().secretKey);
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: {
                publicKey: privacyKit.encodeBase64(toBytes(kp.publicKey)),
                challenge: privacyKit.encodeBase64(challenge),
                signature: privacyKit.encodeBase64(toBytes(badSig)),
            },
        });
        expect(res.statusCode).toBe(401);
    });

    it("returns a token for a valid signature", async () => {
        const app = await buildApp();
        const kp = tweetnacl.sign.keyPair();
        const challenge = new Uint8Array(32);
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: {
                publicKey: privacyKit.encodeBase64(toBytes(kp.publicKey)),
                challenge: privacyKit.encodeBase64(challenge),
                signature: privacyKit.encodeBase64(toBytes(sign(challenge, kp.secretKey))),
            },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().success).toBe(true);
        expect(typeof res.json().token).toBe("string");
    });
});

describe("POST /v1/auth — versioned exchange with replay protection", () => {
    it("issues a token after a challenge is consumed", async () => {
        const app = await buildApp();
        const kp = tweetnacl.sign.keyPair();
        state.exchange = { ok: true };
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: {
                publicKey: privacyKit.encodeBase64(toBytes(kp.publicKey)),
                challenge: state.issued.challenge,
                signature: privacyKit.encodeBase64(Buffer.alloc(64)),
                claimToken: state.issued.claimToken,
            },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().success).toBe(true);
    });

    it("refuses a replay of an already-consumed challenge (410)", async () => {
        const app = await buildApp();
        const kp = tweetnacl.sign.keyPair();
        state.exchange = { ok: false, reason: "already_consumed" };
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: {
                publicKey: privacyKit.encodeBase64(toBytes(kp.publicKey)),
                challenge: state.issued.challenge,
                signature: privacyKit.encodeBase64(Buffer.alloc(64)),
                claimToken: state.issued.claimToken,
            },
        });
        expect(res.statusCode).toBe(410);
        expect(res.json().error).toContain("already_consumed");
    });

    it("refuses a challenge signed for the wrong identity (401)", async () => {
        const app = await buildApp();
        const kp = tweetnacl.sign.keyPair();
        state.exchange = { ok: false, reason: "invalid_signature" };
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth",
            payload: {
                publicKey: privacyKit.encodeBase64(toBytes(kp.publicKey)),
                challenge: state.issued.challenge,
                signature: privacyKit.encodeBase64(Buffer.alloc(64)),
                claimToken: state.issued.claimToken,
            },
        });
        expect(res.statusCode).toBe(401);
    });
});

describe("GET /v1/auth/request/status", () => {
    it("reports not_found for malformed base64 rather than 500", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "GET",
            url: "/v1/auth/request/status",
            query: { publicKey: "!!not-base64!!" },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json().status).toBe("not_found");
    });
});

describe("POST /v1/auth/revoke/*", () => {
    it("revoke/session targets only this token's jti", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/revoke/session",
            headers: { authorization: "Bearer t" },
        });
        expect(res.statusCode).toBe(200);
        expect(state.revocations).toEqual([{ subject: "jti-1", scope: "session" }]);
        expect(state.disconnected).toBe(1);
    });

    it("revoke/device targets only this pairing session", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/revoke/device",
            headers: { authorization: "Bearer t" },
        });
        expect(res.statusCode).toBe(200);
        expect(state.revocations).toEqual([{ subject: "pair-1", scope: "device" }]);
    });

    it("revoke/account targets the account (kills every token)", async () => {
        const app = await buildApp();
        const res = await app.inject({
            method: "POST",
            url: "/v1/auth/revoke/account",
            headers: { authorization: "Bearer t" },
        });
        expect(res.statusCode).toBe(200);
        expect(state.revocations).toEqual([{ subject: "acct-1", scope: "account" }]);
    });
});
