import { Fastify } from "../types";
import { debug } from "@/utils/log";
import { auth } from "@/app/auth/auth";

export function enableAuthentication(app: Fastify) {
    app.decorate('authenticate', async function (request: any, reply: any) {
        try {
            const authHeader = request.headers.authorization;
            const route = request.routeOptions?.url || '<unmatched>';
            debug({ module: 'auth' }, `auth:check route=${route} hasHeader=${!!authHeader}`);
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                debug({ module: 'auth' }, 'auth:failed reason=missing-or-invalid-header');
                return reply.code(401).send({ error: 'Missing authorization header' });
            }

            const token = authHeader.substring(7);
            const verified = await auth.verifyToken(token);
            if (!verified) {
                debug({ module: 'auth' }, 'auth:failed reason=invalid-token');
                return reply.code(401).send({ error: 'Invalid token' });
            }

            debug({ module: 'auth' }, `auth:success userId=${verified.userId}`);
            request.userId = verified.userId;
            // Stable identifiers of this token, so the revocation routes can
            // target exactly this session (its jti) or its pairing device
            // (extras.session) without the client sending them.
            request.jti = verified.jti ?? null;
            request.session = (verified.extras?.session as string | null) ?? null;
        } catch (error) {
            return reply.code(401).send({ error: 'Authentication failed' });
        }
    });
}
