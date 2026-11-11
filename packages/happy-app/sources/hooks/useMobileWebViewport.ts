import * as React from 'react';
import { Platform } from 'react-native';

/** Keep the composer above mobile browser chrome and the on-screen keyboard. */
export function useMobileWebViewport() {
    React.useEffect(() => {
        if (Platform.OS !== 'web' || typeof window === 'undefined') return;
        const viewport = window.visualViewport;
        const update = () => {
            // Pinch zoom must remain a browser operation, not reflow the app.
            if (viewport && viewport.scale !== 1) return;
            document.documentElement.style.setProperty('--agentport-viewport-height', `${viewport?.height ?? window.innerHeight}px`);
        };
        update();
        viewport?.addEventListener('resize', update);
        window.addEventListener('resize', update);
        return () => {
            viewport?.removeEventListener('resize', update);
            window.removeEventListener('resize', update);
            document.documentElement.style.removeProperty('--agentport-viewport-height');
        };
    }, []);
}
