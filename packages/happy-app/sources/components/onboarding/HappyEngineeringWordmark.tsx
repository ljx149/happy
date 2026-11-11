import * as React from 'react';
import { Text } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';

export const HappyEngineeringWordmark = React.memo(function AgentPortWordmark({ height }: { height: number }) {
    const { theme } = useUnistyles();
    return <Text accessibilityRole="header" style={{ fontSize: height * 0.65, lineHeight: height, fontWeight: '700', color: theme.dark ? '#ffffff' : '#173c45', letterSpacing: -1 }}>AgentPort</Text>;
});
