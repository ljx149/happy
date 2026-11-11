import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const AUTH_KEY = 'auth_credentials';

// Cache for synchronous access
let credentialsCache: string | null = null;

export interface AuthCredentials {
    token: string;
    secret: string;
}

export const TokenStorage = {
    async getCredentials(): Promise<AuthCredentials | null> {
        if (Platform.OS === 'web') {
            const stored = localStorage.getItem(AUTH_KEY);
            if (stored) return JSON.parse(stored) as AuthCredentials;
            const { importLegacyUiCredentials, markLegacyIdentityHandled } = await import('./legacyUiCredentials');
            const { authGetToken } = await import('./authGetToken');
            const { getServerUrl } = await import('@/sync/serverConfig');
            const server = getServerUrl();
            const migrated = await importLegacyUiCredentials(server, secret => authGetToken(secret, server));
            if (migrated) {
                localStorage.setItem(AUTH_KEY, JSON.stringify(migrated));
                markLegacyIdentityHandled();
            }
            return migrated;
        }
        try {
            const stored = await SecureStore.getItemAsync(AUTH_KEY);
            if (!stored) return null;
            credentialsCache = stored; // Update cache
            return JSON.parse(stored) as AuthCredentials;
        } catch (error) {
            console.error('Error getting credentials:', error);
            return null;
        }
    },

    async setCredentials(credentials: AuthCredentials): Promise<boolean> {
        if (Platform.OS === 'web') {
            localStorage.setItem(AUTH_KEY, JSON.stringify(credentials));
            return true;
        }
        try {
            const json = JSON.stringify(credentials);
            await SecureStore.setItemAsync(AUTH_KEY, json);
            credentialsCache = json; // Update cache
            return true;
        } catch (error) {
            console.error('Error setting credentials:', error);
            return false;
        }
    },

    async removeCredentials(): Promise<boolean> {
        if (Platform.OS === 'web') {    
            const { markLegacyIdentityHandled } = await import('./legacyUiCredentials');
            markLegacyIdentityHandled();
            localStorage.removeItem(AUTH_KEY);
            return true;
        }
        try {
            await SecureStore.deleteItemAsync(AUTH_KEY);
            credentialsCache = null; // Clear cache
            return true;
        } catch (error) {
            console.error('Error removing credentials:', error);
            return false;
        }
    },
};