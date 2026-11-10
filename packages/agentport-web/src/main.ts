import { AuthStore, AuthState } from './auth/authStore';
import { getTerminalAuthStatus, approveTerminalAuth, AuthError } from './auth/authClient';
import { buildV2ApproverResponse, parsePairingLink } from './auth/pairing';
import { encodeBase64, decodeBase64 } from './auth/crypto';
import { format } from './auth/backup';

// Server address is configured once. Self-host injects __HAPPY_CONFIG__;
// otherwise same-origin. Switching servers never reuses a token silently.
const cfg = {
    baseUrl: (window as unknown as { __HAPPY_CONFIG__?: { serverUrl?: string } }).__HAPPY_CONFIG__?.serverUrl ?? location.origin,
};

const store = new AuthStore(cfg);
let pendingPairKey = location.pathname === '/terminal/connect' ? parsePairingLink(location.hash) : null;
try {
    if (pendingPairKey) sessionStorage.setItem('agentport-pending-pair', encodeBase64(pendingPairKey, 'base64url'));
    else if (location.pathname === '/terminal/connect') {
        const saved = sessionStorage.getItem('agentport-pending-pair');
        if (saved) pendingPairKey = parsePairingLink('#key=' + saved);
    }
} catch { /* Pairing remains available in this tab when storage is restricted. */ }

const screen = document.querySelector('#screen') as HTMLElement;
const sidebar = document.querySelector('#sidebar') as HTMLElement;
const layout = document.querySelector('#layout') as HTMLElement;
const account = document.querySelector('#account') as HTMLButtonElement;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function routeName(): string {
    return location.hash.startsWith('#key=') ? 'pair' : location.hash.slice(1) || (pendingPairKey ? 'pair' : 'home');
}

async function loadMachines(token: string): Promise<Array<{ id: string; hostname: string; online: boolean }>> {
    try {
        const res = await fetch(`${cfg.baseUrl}/v1/machines`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) { store.handleUnauthorized(); void render(); return []; }
        if (!res.ok) return [];
        const machines = (await res.json()) as Array<{ id: string; metadata?: string; active?: boolean; activeAt?: number }>;
            return machines.map(m => ({
            id: m.id,
            hostname: `设备 ${m.id.slice(0, 8)}（名称尚未解密）`,
            online: m.active === true,
        }));
    } catch {
        return [];
    }
}

async function render() {
    const s = store.getState();
    const requested = routeName();

    account.hidden = s.phase !== 'signedIn';
    account.textContent = '账户设置';
    account.disabled = s.phase === 'authenticating';

    if (s.phase !== 'signedIn') sidebar.hidden = true;
    if (s.phase === 'initializing') {
        screen.innerHTML = '<div class="auth hero"><p>加载中…</p></div>';
        return;
    }

    if (s.phase === 'signedOut' || s.phase === 'authenticating') {
        layout.classList.remove('workspace');
        sidebar.hidden = true;
        if (s.phase === 'authenticating') {
            screen.innerHTML = '<div class="auth hero"><p role="status">正在验证身份…</p></div>';
            return;
        }
        if (s.phase === 'signedOut') {
            screen.innerHTML = requested === 'restore' ? restoreTemplate() : loginTemplate();
            return;
        }
    }

    if (s.phase === 'error') {
        layout.classList.remove('workspace');
        sidebar.hidden = true;
        screen.innerHTML = `
            <div class="auth hero">
                <span class="eyebrow">ERROR</span>
                <h1>登录失败</h1>
                <p role="alert">${escapeHtml(s.message)}</p>
                <div class="actions">
                    <a class="button primary" href="#login">返回登录</a>
                    ${s.retryable ? '<button class="button" data-action="retry">重试</button>' : ''}
                </div>
            </div>`;
        return;
    }

    // signedIn
    layout.classList.add('workspace');
    sidebar.hidden = false;
    const machines = await loadMachines(s.token);
    if (store.getState() !== s || routeName() !== requested) return;

    sidebar.innerHTML = `<nav aria-label="工作台导航">
        <a class="button primary" href="#pair">＋ 连接电脑</a>
        <div class="nav">
            <a href="#home" ${requested === 'home' ? 'aria-current="page"' : ''}>工作台</a>
            <a href="#devices" ${requested === 'devices' ? 'aria-current="page"' : ''}>设备</a>
        </div>
        <h2 class="label">设备</h2>
        ${machines.length ? machines.map(m => `<div class="row"><span>${escapeHtml(m.hostname)}<small>本地执行</small></span><span class="status ${m.online ? 'online' : ''}">${m.online ? '● 在线' : '离线'}</span></div>`).join('') : '<p>尚未连接电脑</p>'}
    </nav>`;

    if (requested === 'pair') screen.innerHTML = await pairTemplate(s);
    else if (requested === 'settings') screen.innerHTML = settingsTemplate();
    else if (requested === 'devices') screen.innerHTML = devicesTemplate(machines);
    else screen.innerHTML = homeTemplate(machines);

    screen.focus();
}

function loginTemplate(): string {
    return `
        <div class="auth hero">
            <span class="eyebrow">REMOTE DEVELOPMENT</span>
            <div class="connection-icon">⌘</div><h1>${pendingPairKey ? '连接终端' : '欢迎使用 AgentPort'}</h1>
            <p>${pendingPairKey ? '这台电脑正在请求连接。首次使用请先创建账户，然后确认授权。' : '创建账户，连接你的电脑。无需邮箱或密码。'}</p>
            <div class="actions">
                <button data-action="create" class="primary">创建账户并继续</button>
                <a class="button" href="#restore">恢复已有账户</a>
            </div>
            <p class="fine">账户身份会自动保存在当前浏览器，下次无需重新创建。请在自己的设备上使用。</p>
        </div>`;
}

function restoreTemplate(): string {
    return `
        <div class="auth hero">
            <a class="back" href="#login">‹ 返回登录</a>
            <span class="eyebrow">ACCOUNT RECOVERY</span>
            <h1>恢复账户</h1>
            <p>输入恢复凭据。接受分组 Base32 或 Base64URL 两种形式。</p>
            <div class="panel stack">
                <label class="field">
                    <span class="label">恢复凭据</span>
                    <textarea id="restore-key" rows="3" spellcheck="false" placeholder="XXXXX-XXXXX-… 或 Base64URL 密钥"></textarea>
                </label>
                <div class="actions">
                    <button data-action="restore" class="primary">登录此密钥对应的账户</button>
                    
                </div>
                <p class="fine" role="status" id="restore-status"></p>
            </div>
        </div>`;
}

function backupTemplate(formatted: string): string {
    return `
        <div class="auth hero">
            <span class="eyebrow">BACKUP</span>
            <h1>保存你的恢复凭据</h1>
            <p>备份是可选的。浏览器会自动保存身份；清除浏览器数据后，可用此凭据恢复。请勿向他人透露。</p>
            <div class="panel stack">
                <code class="readout backup">${escapeHtml(formatted)}</code>
                <p class="fine">格式为分组 Base32，共 52 个字符（不含连字符）。</p>
                <div class="actions">
                    <button data-action="backup-done" class="primary">返回工作台</button>
                </div>
            </div>
        </div>`;
}

function homeTemplate(machines: Array<{ id: string; hostname: string; online: boolean }>): string {
    return `
        <div class="page">
            <div class="hero">
                <span class="eyebrow">WORKSPACE</span>
                <h1>工作台</h1>
                <p>在浏览器里继续电脑上的开发任务。</p>
                <div class="actions"><a class="button primary" href="#pair">＋ 连接电脑</a></div>
            </div>
            <div class="stack">
                <section class="panel">
                    <div class="section-head"><h2>设备</h2><a class="back" href="#devices">管理 ›</a></div>
                    ${machines.length ? machines.map(m => `<div class="row"><span>${escapeHtml(m.hostname)}<small>本地执行</small></span><span class="status ${m.online ? 'online' : ''}">${m.online ? '● 在线' : '离线'}</span></div>`).join('') : '<p>尚未连接电脑。运行 <code>happy auth login</code> 并在浏览器确认。</p>'}
                </section>
            </div>
        </div>`;
}

function devicesTemplate(machines: Array<{ id: string; hostname: string; online: boolean }>): string {
    return `
        <div class="page">
            <a class="back" href="#home">‹ 工作台</a>
            <div class="hero">
                <span class="eyebrow">DEVICES</span>
                <h1>设备管理</h1>
                <p>查看已连接电脑及在线状态。</p>
            </div>
            <section class="panel" aria-label="已连接设备">
                ${machines.length ? machines.map(m => `<div class="row"><span>${escapeHtml(m.hostname)}<small>本地执行</small></span><span class="status ${m.online ? 'online' : ''}">${m.online ? '● 在线' : '离线'}</span></div>`).join('') : '<p>暂无设备。连接一台电脑。</p>'}
            </section>
        </div>`;
}

async function pairTemplate(s: AuthState): Promise<string> {
    if (s.phase !== 'signedIn') return '';
    // Parse the CLI's pairing link from the URL hash.
    const cliPub = pendingPairKey ?? parsePairingLink(location.hash);
    if (!cliPub) {
        return `
            <div class="page">
                <a class="back" href="#home">‹ 工作台</a>
                <div class="hero">
                    <span class="eyebrow">TERMINAL LINK</span>
                    <h1>连接电脑</h1>
                    <p>在电脑终端运行以下命令，再在浏览器中确认连接。</p>
                </div>
                <section class="panel stack">
                    <code class="readout">happy auth login</code>
                    <p>CLI 会生成一个 <code>/terminal/connect#key=…</code> 链接。打开它进入确认。</p>
                    <div class="actions"><a class="button" href="#home">返回工作台</a></div>
                </section>
            </div>`;
    }
    // Query the request status.
    let statusText = '查询中…';
    let canApprove = false;
    try {
        const st = await getTerminalAuthStatus(cliPub, cfg);
        if (st.status === 'not_found') statusText = '请求不存在或已过期。请在电脑上重新运行 <code>happy auth login</code>。';
        else if (st.status === 'authorized') statusText = '该请求已被授权。';
        else {
            canApprove = st.supportsV2;
            statusText = canApprove ? '请确认授权这台电脑。' : '此客户端不支持 V2 配对，请更新 CLI。';
        }
    } catch (e) {
        statusText = e instanceof AuthError && e.kind === 'network' ? '网络错误，无法查询请求状态。' : '查询请求状态失败。';
    }
    return `
        <div class="page">
            <a class="back" href="#home">‹ 工作台</a>
            <div class="hero">
                <span class="eyebrow">TERMINAL LINK</span>
                <div class="connection-icon">⌘</div><h1>连接终端</h1>
                <p>${statusText}</p>
            </div>
            <section class="panel stack" id="pair-confirm"><div class="row"><span>请求公钥</span><code>${escapeHtml(encodeBase64(cliPub, 'base64url').slice(0, 12))}…</code></div><div class="row"><span>加密方式</span><span>端到端加密</span></div><p>仅在这次连接由你本人发起时接受。授权后，此终端将连接到你的账户。</p>
                <div class="actions">
                    <button data-action="approve-pair" class="primary" ${canApprove ? '' : 'disabled'}>接受连接</button>
                    <a class="button" href="#home">拒绝</a>
                </div>
                <p class="fine" role="status" id="pair-status"></p>
            </section>
        </div>`;
}

// ---- event wiring -----------------------------------------------------------


screen.addEventListener('click', async event => {
    const action = event.target instanceof Element ? (event.target.closest('[data-action]') as HTMLElement | null)?.dataset.action : undefined;
    const statusEl = () => screen.querySelector('#restore-status, #pair-status') as HTMLElement | null;

    if (action === 'create') {
        try {
            await store.createAccount();
            location.hash = pendingPairKey ? '#pair' : '#home';
            await render();
        } catch { render(); }
    } else if (action === 'show-backup') {
        const state = store.getState();
        if (state.phase === 'signedIn') screen.innerHTML = backupTemplate(format(state.secretBase64Url));
    } else if (action === 'logout') {
        if (!confirm('退出会移除此浏览器保存的身份。请确认已备份恢复凭据，或有其他已登录设备。')) return;
        try {
            await store.logout();
            location.hash = '#login';
            await render();
        } catch {
            screen.innerHTML = '<div class="auth hero"><h1>未能清除本地身份</h1><p>请在浏览器设置中清除此站点数据后关闭页面。</p></div>';
        }
    } else if (action === 'backup-done') {
        location.hash = pendingPairKey ? '#pair' : '#home';
    } else if (action === 'restore') {
        const key = (screen.querySelector('#restore-key') as HTMLTextAreaElement | null)?.value ?? '';
        const el = statusEl(); if (el) el.textContent = '验证中…';
        try {
            await store.restore(key);
            location.hash = pendingPairKey ? '#pair' : '#home';
        } catch {
            render(); // error state renders the message
        }
    } else if (action === 'retry') {
        store.resetError();
        await store.startup();
        await render();
    } else if (action === 'approve-pair') {
        const s = store.getState();
        if (s.phase !== 'signedIn') return;
        const cliPub = pendingPairKey ?? parsePairingLink(location.hash);
        const el = statusEl();
        if (!cliPub) { if (el) el.textContent = '无效的配对链接。'; return; }
        const button = screen.querySelector('[data-action="approve-pair"]') as HTMLButtonElement | null;
        if (button?.disabled) return;
        if (button) button.disabled = true;
        if (el) el.textContent = '正在加密授权材料…';
        try {
            const secret = decodeBase64(s.secretBase64Url, 'base64url');
            const response = await buildV2ApproverResponse(secret, cliPub);
            await approveTerminalAuth(s.token, cliPub, response, cfg);
            if (el) el.textContent = '已提交授权。电脑将接收加密授权材料。';
            pendingPairKey = null;
            try { sessionStorage.removeItem('agentport-pending-pair'); } catch {}
            screen.innerHTML = '<div class="auth hero"><div class="connection-icon">✓</div><h1>终端已获授权</h1><p>请回到终端查看连接结果。设备服务启动后将出现在工作台。</p><a class="button primary" href="#home">打开工作台</a></div>';
        } catch (e) {
            const msg = e instanceof AuthError && e.kind === 'network' ? '网络错误，授权未送达。' : '授权失败。';
            if (el) el.textContent = msg;
            if (button) button.disabled = false;
        }
    }
});

account.addEventListener('click', () => { location.hash = '#settings'; });

window.addEventListener('hashchange', () => {
    if (routeName() === 'login' || routeName() === 'restore') store.resetError();
    render();
});
store.subscribe(s => {
    if (s.phase === 'authenticating' || s.phase === 'error') void render();
});

// Startup: check for a remembered identity, then render.
function settingsTemplate(): string {
    return `<div class="page"><a class="back" href="#home">‹ 工作台</a><h1>账户设置</h1><section class="panel stack"><h2>浏览器身份</h2><p>此浏览器已自动保存账户身份。清除站点数据后，需要恢复凭据或其他登录设备才能恢复账户。</p><button data-action="show-backup">查看恢复凭据（可选备份）</button><button data-action="logout">退出此浏览器</button></section></div>`;
}

store.startup().then(async info => {
    if (info.remembered) {
        // Show a restore screen with an unlock option.
        screen.innerHTML = `
            <div class="auth hero">
                <span class="eyebrow">WELCOME BACK</span>
                <h1>此浏览器有保存的身份</h1>
                <p>用解锁口令恢复上次登录的账户。</p>
                <div class="panel stack">
                    <label class="field">
                        <span class="label">解锁口令</span>
                        <input id="unlock-phrase" type="password" autocomplete="current-password">
                    </label>
                    <div class="actions">
                        <button data-action="unlock" class="primary">解锁</button>
                        <a class="button" href="#login">改用恢复凭据</a>
                    </div>
                    <p class="fine" role="status" id="unlock-status"></p>
                </div>
            </div>`;
        screen.addEventListener('click', async e => {
            if (e.target instanceof Element && e.target.closest('[data-action="unlock"]')) {
                const phrase = (screen.querySelector('#unlock-phrase') as HTMLInputElement | null)?.value ?? '';
                const el = screen.querySelector('#unlock-status') as HTMLElement | null;
                if (el) el.textContent = '解锁中…';
                try {
                    await store.unlockRemembered(phrase);
                    location.hash = pendingPairKey ? '#pair' : '#home';
                    await render();
                } catch {
                    if (el) el.textContent = '口令错误，请重试。';
                }
            }
        }, { once: false });
    } else {
        await render();
    }
});
