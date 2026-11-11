import { useAuth } from '@/auth/AuthContext';
import { authGetToken } from '@/auth/authGetToken';
import { getRandomBytesAsync } from 'expo-crypto';
import { encodeBase64 } from '@/encryption/base64';
import { createTerminalAccountFlow } from '@/auth/terminalAccount';
import { rememberTerminal, pendingTerminal, forgetTerminal } from '@/auth/pendingTerminal';
import { Modal } from '@/modal';
import React, { useState, useEffect, useRef } from 'react';
import { View, Platform } from 'react-native';
import { Text } from '@/components/StyledText';
import { useRouter } from 'expo-router';
import { Typography } from '@/constants/Typography';
import { RoundButton } from '@/components/RoundButton';
import { useConnectTerminal } from '@/hooks/useConnectTerminal';
import { Ionicons } from '@expo/vector-icons';
import { ItemList } from '@/components/ItemList';
import { ItemGroup } from '@/components/ItemGroup';
import { Item } from '@/components/Item';
import { t } from '@/text';

export default function TerminalConnectScreen() {
    const router = useRouter();
    const auth = useAuth();
    const [creatingAccount, setCreatingAccount] = useState(false);
    const connecting = useRef(false);
    const accountFlow = useRef(createTerminalAccountFlow({
        create: async () => {
            const secret = await getRandomBytesAsync(32);
            const token = await authGetToken(secret);
            if (typeof token !== 'string' || !token) throw new Error('账户创建失败，请重试。');
            return { token, secret: encodeBase64(secret, 'base64url') };
        },
        login: auth.login,
    }));
    const [publicKey, setPublicKey] = useState<string | null>(null);
    const [hashProcessed, setHashProcessed] = useState(false);
    const { processAuthUrl, isLoading } = useConnectTerminal({
        onSuccess: () => {
            forgetTerminal();
            router.replace('/');
        }
    });

    // Extract key from hash on web platform
    useEffect(() => {
        if (Platform.OS === 'web' && typeof window !== 'undefined' && !hashProcessed) {
            const hash = window.location.hash;
            const key = hash ? new URLSearchParams(hash.slice(1)).get('key') : pendingTerminal();
            if (key && /^[A-Za-z0-9_-]{43}$/.test(key)) {
                setPublicKey(key);
                try {
                    rememberTerminal(key);
                    window.history.replaceState(null, '', window.location.pathname + window.location.search);
                } catch { /* Keep the URL when session storage is unavailable. */ }
            }
            setHashProcessed(true);
        }
    }, [hashProcessed]);

    const handleConnect = async () => {
        if (!publicKey || connecting.current) return;
        connecting.current = true;
        setCreatingAccount(true);
        try {
            const credentials = await accountFlow.current(auth.credentials);
            await processAuthUrl(`happy://terminal?${publicKey}`, credentials);
        } catch {
            Modal.alert('无法完成账户初始化', '未连接电脑。请确认浏览器允许保存网站数据，然后刷新页面重试；已保存的账户和待连接请求会保留。', [
                { text: '取消' },
                { text: '刷新后重试', onPress: () => { if (Platform.OS === 'web') window.location.reload(); } },
            ]);
        } finally {
            connecting.current = false;
            setCreatingAccount(false);
        }
    };
    const busy = isLoading || creatingAccount;
    const handleReject = () => {
        forgetTerminal();
        router.replace('/');
    };

    // Show placeholder for mobile platforms
    if (Platform.OS !== 'web') {
        return (
            <ItemList>
                <ItemGroup>
                    <View style={{ 
                        alignItems: 'center',
                        paddingVertical: 32,
                        paddingHorizontal: 16
                    }}>
                        <Ionicons 
                            name="laptop-outline" 
                            size={64} 
                            color="#8E8E93" 
                            style={{ marginBottom: 16 }} 
                        />
                        <Text style={{ 
                            ...Typography.default('semiBold'), 
                            fontSize: 18, 
                            textAlign: 'center',
                            marginBottom: 12 
                        }}>
                            {t('terminal.webBrowserRequired')}
                        </Text>
                        <Text style={{ 
                            ...Typography.default(), 
                            fontSize: 14, 
                            color: '#666', 
                            textAlign: 'center',
                            lineHeight: 20 
                        }}>
                            {t('terminal.webBrowserRequiredDescription')}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        );
    }

    // Show loading state while processing hash
    if (!hashProcessed) {
        return (
            <ItemList>
                <ItemGroup>
                    <View style={{ 
                        alignItems: 'center',
                        paddingVertical: 32,
                        paddingHorizontal: 16
                    }}>
                        <Text style={{ ...Typography.default(), color: '#666' }}>
                            {t('terminal.processingConnection')}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        );
    }

    // Show error if no key found
    if (!publicKey) {
        return (
            <ItemList>
                <ItemGroup>
                    <View style={{ 
                        alignItems: 'center',
                        paddingVertical: 32,
                        paddingHorizontal: 16
                    }}>
                        <Ionicons 
                            name="warning-outline" 
                            size={48} 
                            color="#FF3B30" 
                            style={{ marginBottom: 16 }} 
                        />
                        <Text style={{ 
                            ...Typography.default('semiBold'), 
                            fontSize: 16, 
                            color: '#FF3B30',
                            textAlign: 'center',
                            marginBottom: 8 
                        }}>
                            {t('terminal.invalidConnectionLink')}
                        </Text>
                        <Text style={{ 
                            ...Typography.default(), 
                            fontSize: 14, 
                            color: '#666', 
                            textAlign: 'center',
                            lineHeight: 20 
                        }}>
                            {t('terminal.invalidConnectionLinkDescription')}
                        </Text>
                    </View>
                </ItemGroup>
            </ItemList>
        );
    }

    // Show confirmation screen for valid connection
    return (
        <ItemList>
            {/* Connection Request Header */}
            <ItemGroup>
                <View style={{ 
                    alignItems: 'center',
                    paddingVertical: 24,
                    paddingHorizontal: 16
                }}>
                    <Ionicons 
                        name="terminal-outline" 
                        size={48} 
                        color="#007AFF" 
                        style={{ marginBottom: 16 }} 
                    />
                    <Text style={{ 
                        ...Typography.default('semiBold'), 
                        fontSize: 20, 
                        textAlign: 'center',
                        marginBottom: 12
                    }}>
                        {t('terminal.connectTerminal')}
                    </Text>
                    <Text style={{ 
                        ...Typography.default(), 
                        fontSize: 14, 
                        color: '#666', 
                        textAlign: 'center',
                        lineHeight: 20 
                    }}>
                        {t('terminal.terminalRequestDescription')}
                    </Text>
                </View>
            </ItemGroup>

            {/* Connection Details */}
            <ItemGroup title={t('terminal.connectionDetails')}>
                <Item
                    title={t('terminal.publicKey')}
                    detail={`${publicKey.substring(0, 12)}...`}
                    icon={<Ionicons name="key-outline" size={29} color="#007AFF" />}
                    showChevron={false}
                />
                <Item
                    title={t('terminal.encryption')}
                    detail={t('terminal.endToEndEncrypted')}
                    icon={<Ionicons name="lock-closed-outline" size={29} color="#34C759" />}
                    showChevron={false}
                />
            </ItemGroup>

            {/* Action Buttons */}
            <ItemGroup>
                <View style={{ 
                    paddingHorizontal: 16,
                    paddingVertical: 16,
                    gap: 12 
                }}>
                    {!auth.isAuthenticated && (
                        <>
                            <Text style={{ ...Typography.default(), textAlign: 'center', marginBottom: 8 }}>
                                将在当前浏览器创建账户并连接电脑。已有账户？请先恢复账户，以继续使用原有设备和会话。
                            </Text>
                            <RoundButton title="恢复已有账户" onPress={() => router.push('/restore')} display="inverted" disabled={busy} />
                        </>
                    )}
                    <RoundButton
                        title={busy ? t('terminal.connecting') : auth.isAuthenticated ? t('terminal.acceptConnection') : '创建账户并连接'}
                        onPress={handleConnect}
                        size="large"
                        disabled={busy}
                        loading={busy}
                    />
                    <RoundButton
                        title={t('terminal.reject')}
                        onPress={handleReject}
                        size="large"
                        display="inverted"
                        disabled={busy}
                    />
                </View>
            </ItemGroup>

            {/* Security Notice */}
            <ItemGroup 
                title={t('terminal.security')}
                footer={t('terminal.securityFooter')}
            >
                <Item
                    title={t('terminal.clientSideProcessing')}
                    subtitle={t('terminal.linkProcessedLocally')}
                    icon={<Ionicons name="shield-checkmark-outline" size={29} color="#34C759" />}
                    showChevron={false}
                />
            </ItemGroup>
        </ItemList>
    );
}