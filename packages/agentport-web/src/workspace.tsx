import { createRoot, type Root } from 'react-dom/client';
import { WorkbenchPage } from './pages/WorkbenchPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { contentKeys, decode } from './lib/protocol';

let root: Root | undefined;
let generation = 0;

export function unmountWorkspace() {
    generation++;
    root?.unmount();
    root = undefined;
}

export async function mountWorkspace(
    element: HTMLElement, token: string, secret: string, sessionId: string | undefined,
    isCurrent: () => boolean,
) {
    const current = generation;
    const account = { token, keys: await contentKeys(decode(secret)) };
    if (current !== generation || !isCurrent()) return;
    element.replaceChildren();
    root = createRoot(element);
    root.render(sessionId
        ? <SessionDetailPage account={account} id={sessionId} />
        : <WorkbenchPage account={account} />);
}
