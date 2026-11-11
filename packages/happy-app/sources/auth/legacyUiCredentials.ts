import { decodeBase64 } from '@/encryption/base64';
import type { AuthCredentials } from './tokenStorage';

const IMPORTED = 'agentport-classic-legacy-imported';
export function markLegacyIdentityHandled() { localStorage.setItem(IMPORTED, '1'); }

async function readLegacySecret(origin: string): Promise<string | null> {
    return new Promise(resolve => {
        const request = indexedDB.open('agentport-web-credentials');
        request.onupgradeneeded = () => { request.transaction?.abort(); resolve(null); };
        request.onerror = () => resolve(null);
        request.onsuccess = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('credentials')) { db.close(); resolve(null); return; }
            const tx = db.transaction('credentials', 'readonly');
            const read = tx.objectStore('credentials').get(`identity:${origin}`);
            let secret: string | null = null;
            read.onsuccess = () => { if (typeof read.result === 'string') secret = read.result; };
            tx.oncomplete = () => { db.close(); resolve(secret); };
            tx.onerror = tx.onabort = () => { db.close(); resolve(null); };
        };
    });
}

/** Same-origin, one-time adoption. Never delete the fallback UI's identity. */
export async function importLegacyUiCredentials(server: string, getToken: (secret: Uint8Array) => Promise<string>): Promise<AuthCredentials | null> {
    if (new URL(server).origin !== location.origin || localStorage.getItem(IMPORTED)) return null;
    const secret = await readLegacySecret(location.origin);
    if (!secret) return null;
    const bytes = decodeBase64(secret, 'base64url');
    if (bytes.length !== 32) throw new Error('原界面的账户信息格式不正确，请使用备用界面检查。');
    const token = await getToken(bytes);
    if (typeof token !== 'string' || !token) throw new Error('无法恢复原界面的账户，请稍后重试。');
    return { token, secret };
}
