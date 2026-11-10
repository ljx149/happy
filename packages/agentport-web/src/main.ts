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

const screen = document.querySelector('#screen')!;
const sidebar = document.querySelector('#sidebar')!;
const layout = document.querySelector('#layout')!;
const account = document.querySelector('#account')!;

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function routeName(): string {
    return location.hash.slice(1) || 'home';
}

async function loadMachines(token: string): Promise<Array<{ id: string; hostname: string; online: boolean }>> {
    try {
        const res = await fetch(`${cfg.baseUrl}/v1/machines`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) { store.handleUnauthorized(); return []; }
        if (!res.ok) return [];
        const machines = (await res.json()) as Array<{ id: string; metadata?: { hostname?: string }; lastActiveAt?: string }>;
        const now = Date.now();
        return machines.map(m => ({
            id: m.id,
            hostname: m.metadata?.hostname ?? m.id.slice(0, 8),
            online: m.lastActiveAt ? now - new Date(m.lastActiveAt).getTime() < 60_000 : false,
        }));
    } catch {
        return [];
    }
}

async function render() {
    const s = store.getState();
    const requested = routeName();

    account.hidden = s.phase !== 'signedIn';
    account.textContent = s.phase === 'signedIn' ? '退出此浏览器' : '账户';
    account.disabled = s.phase === 'authenticating';

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
            screen.innerHTML = loginTemplate();
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
    else if (requested === 'devices') screen.innerHTML = devicesTemplate(machines);
    else screen.innerHTML = homeTemplate(machines);

    screen.focus();
}

function loginTemplate(): string {
    return `
        <div class="auth hero">
            <span class="eyebrow">REMOTE DEVELOPMENT</span>
            <h1>电脑上的开发，<br>在这里继续。</h1>
            <p>创建账户或恢复已有账户。身份由恢复凭据保护，不依赖邮箱密码。</p>
            <div class="actions">
                <button data-action="create" class="primary">创建账户 ↗</button>
                <a class="button" href="#restore">恢复已有账户</a>
            </div>
            <p class="fine">凭据仅保存在当前浏览器，不会发送到其他服务。</p>
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
                    <button data-action="remember-check" class="button">记住此浏览器</button>
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
            <p>这是唯一能恢复账户的凭据。离线保存，丢失后无法找回。</p>
            <div class="panel stack">
                <code class="readout backup">${escapeHtml(formatted)}</code>
                <p class="fine">格式为分组 Base32，共 52 个字符（含连字符）。</p>
                <div class="actions">
                    <button data-action="backup-done" class="primary">我已保存，继续 ↗</button>
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
                <p>查看已连接电脑，添加或撤销设备。</p>
            </div>
            <section class="panel" aria-label="已连接设备">
                ${machines.length ? machines.map(m => `<div class="row"><span>${escapeHtml(m.hostname)}<small>本地执行</small></span><span class="status ${m.online ? 'online' : ''}">${m.online ? '● 在线' : '离线'}</span></div>`).join('') : '<p>暂无设备。连接一台电脑。</p>'}
            </section>
        </div>`;
}

async function pairTemplate(s: AuthState): Promise<string> {
    if (s.phase !== 'signedIn') return '';
    // Parse the CLI's pairing link from the URL hash.
    const cliPub = parsePairingLink(location.hash);
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
    try {
        const st = await getTerminalAuthStatus(cliPub, cfg);
        if (st.status === 'not_found') statusText = '请求不存在或已过期。请在电脑上重新运行 <code>happy auth login</code>。';
        else if (st.status === 'authorized') statusText = '该请求已被授权。';
        else statusText = '等待电脑确认。';
    } catch (e) {
        statusText = e instanceof AuthError && e.kind === 'network' ? '网络错误，无法查询请求状态。' : '查询请求状态失败。';
    }
    return `
        <div class="page">
            <a class="back" href="#home">‹ 工作台</a>
            <div class="hero">
                <span class="eyebrow">TERMINAL LINK</span>
                <h1>确认连接这台电脑</h1>
                <p>${statusText}</p>
            </div>
            <section class="panel stack" id="pair-confirm">
                <div class="actions">
                    <button data-action="approve-pair" class="primary">确认并授权</button>
                    <a class="button" href="#home">取消</a>
                </div>
                <p class="fine" role="status" id="pair-status"></p>
            </section>
        </div>`;
}

// ---- event wiring -----------------------------------------------------------

let currentBackup: string | null = null;

screen.addEventListener('click', async event => {
    const action = event.target instanceof Element ? event.target.closest('[data-action]')?.dataset.action : undefined;
    const statusEl = () => screen.querySelector('#restore-status, #pair-status') as HTMLElement | null;

    if (action === 'create') {
        try {
            const { formattedBackup, secretBase64Url } = await store.createAccount();
            currentBackup = secretBase64Url;
            screen.innerHTML = backupTemplate(formattedBackup);
        } catch { render(); }
    } else if (action === 'backup-done') {
        location.hash = '#home';
    } else if (action === 'restore') {
        const key = (screen.querySelector('#restore-key') as HTMLTextAreaElement | null)?.value ?? '';
        const el = statusEl(); if (el) el.textContent = '验证中…';
        try {
            await store.restore(key);
            location.hash = '#home';
        } catch {
            render(); // error state renders the message
        }
    } else if (action === 'remember-check') {
        const phrase = prompt('设置一个解锁口令，用于“记住此浏览器”。\n口令不会存储，仅用于派生本地加密密钥。');
        if (!phrase) return;
        const s = store.getState();
        if (s.phase === 'signedIn') {
            await store.remember(phrase);
            const el = statusEl(); if (el) el.textContent = '已记住此浏览器。下次刷新可用同一口令解锁。';
        }
    } else if (action === 'retry') {
        render();
    } else if (action === 'approve-pair') {
        const s = store.getState();
        if (s.phase !== 'signedIn') return;
        const cliPub = parsePairingLink(location.hash);
        const el = statusEl();
        if (!cliPub) { if (el) el.textContent = '无效的配对链接。'; return; }
        if (el) el.textContent = '正在加密授权材料…';
        try {
            const secret = decodeBase64(s.secretBase64Url, 'base64url');
            const response = await buildV2ApproverResponse(secret, cliPub);
            await approveTerminalAuth(s.token, cliPub, response, cfg);
            if (el) el.textContent = '已授权。电脑将接收恢复凭据。';
            setTimeout(() => { location.hash = '#home'; }, 1200);
        } catch (e) {
            const msg = e instanceof AuthError && e.kind === 'network' ? '网络错误，授权未送达。' : '授权失败。';
            if (el) el.textContent = msg;
        }
    }
});

account.addEventListener('click', () => {
    store.logout().then(render);
});

window.addEventListener('hashchange', () => render());

// Startup: check for a remembered identity, then render.
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
                    location.hash = '#home';
                } catch {
                    if (el) el.textContent = '口令错误，请重试。';
                }
            }
        }, { once: false });
    } else {
        await render();
    }
});
