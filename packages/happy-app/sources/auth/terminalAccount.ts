import type { AuthCredentials } from './tokenStorage';

/** Keep the same identity on retry; never approve before persistence/login succeeds. */
export function createTerminalAccountFlow(deps: {
    create: () => Promise<AuthCredentials>;
    login: (token: string, secret: string) => Promise<void>;
}) {
    let candidate: AuthCredentials | null = null;
    let pending: Promise<AuthCredentials> | null = null;
    return (current: AuthCredentials | null): Promise<AuthCredentials> => {
        if (current) return Promise.resolve(current);
        if (pending) return pending;
        pending = (async () => {
            candidate ??= await deps.create();
            await deps.login(candidate.token, candidate.secret);
            return candidate;
        })().finally(() => { pending = null; });
        return pending;
    };
}
