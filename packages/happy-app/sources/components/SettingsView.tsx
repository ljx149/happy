import * as React from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Item } from '@/components/Item';
import { ItemGroup } from '@/components/ItemGroup';
import { ItemList } from '@/components/ItemList';
import { useUnistyles } from 'react-native-unistyles';
import { t } from '@/text';

type BuildConfig = {
    buildCommitSha?: unknown;
    buildCommitTimestamp?: unknown;
};

function getBuildConfig(): BuildConfig {
    const appConfig = Constants.expoConfig?.extra?.app;
    return appConfig && typeof appConfig === 'object' ? appConfig as BuildConfig : {};
}

function formatUtcTimestamp(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
        .replace(/:\d{2}Z$/, 'Z')
        .replace('T', ' ')
        .replace('Z', ' UTC');
}

function formatBuildSubtitle(buildConfig: BuildConfig): string | undefined {
    const commitTimestamp = typeof buildConfig.buildCommitTimestamp === 'string'
        ? formatUtcTimestamp(buildConfig.buildCommitTimestamp)
        : undefined;
    const commitSha = typeof buildConfig.buildCommitSha === 'string'
        ? buildConfig.buildCommitSha.slice(0, 7)
        : undefined;

    if (!commitTimestamp && !commitSha) {
        return undefined;
    }

    return [
        commitTimestamp ? `Commit ${commitTimestamp}` : 'Commit',
        commitSha,
    ].filter(Boolean).join(' / ');
}

/** Shared by the full settings screen and desktop settings panel. */
export const SettingsView = React.memo(function SettingsView({
    topContentInset = 0,
    bottomContentInset = 0,
    onScroll,
}: {
    topContentInset?: number;
    bottomContentInset?: number;
    onScroll?: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
}) {
    const { theme } = useUnistyles();
    const router = useRouter();
    const version = Constants.expoConfig?.version;
    return (
        <ItemList
            style={{ paddingTop: 0 }}
            containerStyle={{ paddingTop: topContentInset, paddingBottom: bottomContentInset }}
            onScroll={onScroll}
            scrollEventThrottle={16}
        >
            <ItemGroup>
                <Item
                    title={t('settings.account')}
                    subtitle={t('settings.accountSubtitle')}
                    icon={<Ionicons name="person-circle-outline" size={29} color="#007AFF" />}
                    onPress={() => router.push('/settings/account')}
                />
                <Item
                    title="Agent"
                    icon={<Ionicons name="options-outline" size={29} color="#5AC8FA" />}
                    onPress={() => router.push('/settings/agents' as any)}
                />
            </ItemGroup>
            <ItemGroup>
                <Item
                    title={t('settings.whatsNew')}
                    subtitle={t('settings.whatsNewSubtitle')}
                    icon={<Ionicons name="sparkles-outline" size={29} color="#FF9500" />}
                    onPress={() => router.push('/changelog')}
                />
                <Item
                    title={t('common.version')}
                    subtitle={[
                        version ? `AgentPort Web ${version}` : 'AgentPort Web',
                        formatBuildSubtitle(getBuildConfig()),
                    ].filter(Boolean).join('\n')}
                    subtitleLines={0}
                    icon={<Ionicons name="information-circle-outline" size={29} color={theme.colors.textSecondary} />}
                    showChevron={false}
                />
                {/* Report issue stays hidden until the official feedback URL is confirmed.
                    Do not fall back to upstream GitHub or a guessed website route. */}
            </ItemGroup>
        </ItemList>
    );
});
