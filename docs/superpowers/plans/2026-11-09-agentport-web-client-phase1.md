# AgentPort Web Client 第一阶段实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `packages/agentport-web/` 用 React + TypeScript + Vite 实现浏览器客户端，打通 V2 终端配对、账户创建/恢复、dataKey 会话解密与双向消息收发。第一阶段只验收 dataKey，遇 legacy 会话提示"暂不支持"，禁止静默回退。

**Architecture:** 浏览器持有 32 字节 masterSecret（恢复凭据），经 HMAC-SHA512 密钥树派生 content 密钥（`deriveKey(master, 'Happy EnCoder', ['content'])`），**再做 SHA-512 取前 32 字节作 X25519 secret**（与 CLI `libsodiumPublicKeyFromSecretKey` 和 Android `Sodium.boxSeedKeypair` 一致），生成 box 公钥对。V2 配对时把 `0x00 || contentPub` 用 box 加密到 CLI 的临时公钥。CLI 创建会话时生成随机 32 字节 AES key，box 加密到 contentPub 后以 `0x00 || box` 格式存为 `dataEncryptionKey`。浏览器 boxDecrypt 得到 AES key 后，**直接用该 key 做 AES-256-GCM 解密消息（不做第二层 deriveKey）**。消息读写走 V3 路由（`/v3/sessions/:id/messages`），会话列表走 `/v1/sessions`。所有加密用 Web Crypto（AES-GCM、HMAC-SHA512、SHA-512）+ tweetnacl（box、sign），不碰 node:crypto。

**Tech Stack:** React 18, TypeScript, Vite 5, socket.io-client, tweetnacl, happy-wire（Zod schema，浏览器可直接 import），Web Crypto API。

**Spec:** `docs/plans/agentport-implementation-plan.md`（AgentPort P0 实施计划，本计划实现其阶段 1 的 Web 侧）

## Global Constraints

- 锁定版本 `a566fc3`，不跨版本混用构建产物
- Vite 构建产物通过 `HAPPY_STATIC_DIR` 由 Self-host Server 提供，`/terminal/connect` 深链接直刷必须加载对应页面
- 浏览器侧不用 `node:crypto`，所有密码学操作走 Web Crypto + tweetnacl
- 遇 legacy 会话（`dataEncryptionKey === null`）显示"暂不支持"，禁止静默回退到 tweetnacl.secretbox
- 恢复凭据、私钥、token 不得出现在日志、录屏或提交历史中
- 保留现有 `style.css` 的 Xcoder 视觉，不引入新设计系统
- **消息读写走 `/v3/sessions/:id/messages`**，会话列表走 `/v1/sessions`
- **内容密钥派生**：`deriveKey(master, 'Happy EnCoder', ['content'])` → SHA-512 → 取前 32 字节 → X25519（必须两步，不能直接 `fromSecretKey`）
- **消息 AES-GCM 直接用 box 解封后的原始 AES 密钥**，不做第二层 deriveKey（`deriveKey(aesKey, 'Happy Blobs', ['session'])` 是 CLI `getBlobKey()` 给附件用的，不是消息用的）
- **配对不可用与服务端强制过期分开**：服务端无 age 检查，`not_found` 只表示请求不存在。浏览器收到 `not_found` 显示"请求不存在或已过期，请在电脑上重新运行 auth login"，不循环重试。CLI 端轮询超时是客户端行为，与 `not_found` 是两个独立场景。
- **Reviewer 三道验收卡点**：Task 2–4 验证官方派生向量和真实 CLI V2 配对；Task 5–6 验证 CLI 与浏览器双向加解密及 V3 消息收发；Task 7 用干净配置跑完端到端并在第二个浏览器恢复同一会话。其余任务可连续执行。

## Review Focus

- 恢复凭据在 IndexedDB 中的存储：刷新页面后账户不能静默消失，也不能被其他用户读走——验证 IndexedDB 隔离
- `/terminal/connect` 链接过期后用户看到的状态：请求不存在（`not_found`）与 CLI 端超时是两个不同场景，浏览器应显示"请求不存在或已过期，请在电脑上重新运行 auth login"，不循环重试
- Socket.IO 断线重连：浏览器与 CLI 在同一 session 上同时在线时，消息不能丢失也不能重复——需要验证 seq 去重
- 并发双浏览器：同一账户在两个浏览器同时打开，消息必须双向同步且加密格式一致
- 浏览器 AES-GCM 与 CLI Node crypto 的互通：nonce 和 authTag 拼接顺序必须严格一致（version(1) || nonce(12) || ct || tag(16)）
- 内容密钥 SHA-512 取前 32 字节：不能跳过，不能直接 `tweetnacl.box.keyPair.fromSecretKey(contentKey)`

---

### Task 1: 脚手架 — Vite + React + TS + 路由

**Files:**
- Modify: `pnpm-workspace.yaml`（把 `packages/agentport-web` 加入 workspace）
- Create: `packages/agentport-web/package.json`
- Create: `packages/agentport-web/tsconfig.json`
- Create: `packages/agentport-web/vite.config.ts`
- Create: `packages/agentport-web/src/main.tsx`
- Create: `packages/agentport-web/src/App.tsx`
- Create: `packages/agentport-web/src/vite-env.d.ts`
- Modify: `packages/agentport-web/index.html`（替换现有 vanilla JS 入口为 Vite React 入口）
- Keep: `packages/agentport-web/style.css`（Xcoder 主题，不改）
- Delete: `packages/agentport-web/app.js`（vanilla JS，被 React 替代）
- Keep: `packages/agentport-web/README.md`（更新为 React 版说明）

**Interfaces:**
- Produces: `App` 组件（默认导出，路由分发到各页面组件）
- Produces: 五个页面组件占位：`LoginPage`、`RestorePage`、`TerminalConnectPage`、`WorkbenchPage`、`SessionDetailPage`
- Consumes: `style.css`（在 `main.tsx` 中 import）

- [ ] **Step 1: 更新 pnpm-workspace.yaml**

在 `packages` 列表末尾追加 `packages/agentport-web`。

- [ ] **Step 2: 初始化 package.json**

```json
{
  "name": "agentport-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "socket.io-client": "^4.7.5",
    "tweetnacl": "^1.0.3",
    "happy-wire": "workspace:*"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.5.0",
    "vite": "^5.4.0",
    "vitest": "^2.0.0"
  }
}
```

`happy-wire` 用 `workspace:*` 引用（pnpm workspace 约定），Task 5 中 import 其 `SessionMessageSchema` / `MessageContentSchema`。

- [ ] **Step 3: 写 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "skipLibCheck": true,
    "paths": {
      "@/lib/*": ["src/lib/*"],
      "@/pages/*": ["src/pages/*"]
    }
  },
  "include": ["src"]
}
```

- [ ] **Step 4: 写 vite.config.ts**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  server: { proxy: { '/v1': 'http://127.0.0.1:3005', '/v3': 'http://127.0.0.1:3005' } },
});
```

- [ ] **Step 5: 更新 index.html 为 Vite 入口**

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#101720">
  <title>AgentPort · 远程开发工作台</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```

- [ ] **Step 6: 创建占位页面组件**

创建 `src/pages/LoginPage.tsx`、`RestorePage.tsx`、`TerminalConnectPage.tsx`、`WorkbenchPage.tsx`、`SessionDetailPage.tsx`，每个只返回 `<div>页面名占位</div>`。

- [ ] **Step 7: 写 App.tsx 路由**

```tsx
import { useEffect, useState } from 'react';
import { LoginPage } from './pages/LoginPage';
import { RestorePage } from './pages/RestorePage';
import { TerminalConnectPage } from './pages/TerminalConnectPage';
import { WorkbenchPage } from './pages/WorkbenchPage';
import { SessionDetailPage } from './pages/SessionDetailPage';

function route() {
  const { pathname, hash } = window.location;
  if (pathname === '/terminal/connect') return { page: 'terminal-connect', key: hash.replace('#key=', '') };
  if (hash === '#restore') return { page: 'restore' };
  if (hash.startsWith('#session/')) return { page: 'session-detail', id: hash.split('/')[2] };
  if (hash === '#home') return { page: 'workbench' };
  return { page: 'login' };
}

export default function App() {
  const [r, setR] = useState(route);
  useEffect(() => {
    const fn = () => setR(route());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);
  switch (r.page) {
    case 'terminal-connect': return <TerminalConnectPage key={r.key} />;
    case 'restore': return <RestorePage />;
    case 'session-detail': return <SessionDetailPage id={r.id} />;
    case 'workbench': return <WorkbenchPage />;
    default: return <LoginPage />;
  }
}
```

- [ ] **Step 8: 写 main.tsx**

```tsx
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
createRoot(document.getElementById('root')!).render(<App />);
```

- [ ] **Step 9: 删除 app.js，安装依赖，构建**

删除 `packages/agentport-web/app.js`，运行 `pnpm --filter agentport-web install && pnpm --filter agentport-web build`。预期：tsc 无错，vite 产出 `dist/index.html`。

- [ ] **Step 10: 提交**

```bash
git add packages/agentport-web/ pnpm-workspace.yaml docs/superpowers/plans/2026-11-09-agentport-web-client-phase1.md
git commit -m "feat(agentport-web): scaffold Vite+React+TS with Xcoder theme and page routing"
```

---

### Task 2: 密码学基元 — base64、deriveKey、SHA-512→X25519、AES-GCM、box

**Files:**
- Create: `packages/agentport-web/src/lib/base64.ts`
- Create: `packages/agentport-web/src/lib/deriveKey.ts`
- Create: `packages/agentport-web/src/lib/encryptDataKey.ts`
- Test: `packages/agentport-web/src/lib/base64.test.ts`
- Test: `packages/agentport-web/src/lib/deriveKey.test.ts`
- Test: `packages/agentport-web/src/lib/encryptDataKey.test.ts`

**Interfaces:**
- Produces: `encodeBase64(buf: Uint8Array, variant?: 'base64'|'base64url'): string`
- Produces: `decodeBase64(s: string, variant?: 'base64'|'base64url'): Uint8Array`
- Produces: `deriveKey(master: Uint8Array, usage: string, path: string[]): Promise<Uint8Array>`（HMAC-SHA512 密钥树，与 CLI `utils/deriveKey.ts` 语义相同）
- Produces: `boxKeyPairFromSeed(seed: Uint8Array): tweetnacl.BoxKeyPair`（**先 SHA-512(seed) 取前 32 字节作 X25519 secret，再生成公钥对**——与 CLI `libsodiumPublicKeyFromSecretKey` + Android `Sodium.boxSeedKeypair` 一致）
- Produces: `encryptDataKey(data: unknown, aesKey: Uint8Array): Promise<Uint8Array>`（AES-256-GCM，bundle = version(1)=0 || nonce(12) || ct || tag(16)）
- Produces: `decryptDataKey(bundle: Uint8Array, aesKey: Uint8Array): Promise<any|null>`
- Produces: `boxEncrypt(data: Uint8Array, recipientPub: Uint8Array): { bundle: Uint8Array; ephemeralPub: Uint8Array }`（tweetnacl.box，与 CLI `libsodiumEncryptForPublicKey` 格式一致）
- Produces: `boxDecrypt(bundle: Uint8Array, secretKey: Uint8Array): Uint8Array|null`
- Consumes: tweetnacl, Web Crypto API

- [ ] **Step 1: 写 base64.test.ts 失败测试**

```ts
import { encodeBase64, decodeBase64 } from './base64';
const hello = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
expect(encodeBase64(hello)).toBe('SGVsbG8=');
expect(decodeBase64('SGVsbG8=')).toEqual(hello);
const b64url = encodeBase64(new Uint8Array([0xfb, 0xff, 0xfe]), 'base64url');
expect(b64url).toBe('-_8');
expect(decodeBase64(b64url, 'base64url')).toEqual(new Uint8Array([0xfb, 0xff, 0xfe]));
```

- [ ] **Step 2: 运行测试确认失败** → 模块不存在

- [ ] **Step 3: 实现 base64.ts**

用 `btoa`/`atob`，base64url 变体在编码时替换 `+`→`-`、`/`→`_` 并去掉 `=`，解码时反向还原。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 写 deriveKey.test.ts 失败测试（固定向量）**

```ts
import { deriveKey, boxKeyPairFromSeed } from './deriveKey';
// 固定向量（由锁定版本 CLI 的官方函数生成，master = 32 字节全 0xAB）
const ms = new Uint8Array(32).fill(0xab);
const key = await deriveKey(ms, 'Happy EnCoder', ['content']);
// 官方向量：content key = f30653dfd9862bb061fa8628134c672245db078e2ddba93508e856b5b762802b
expect(key).toHaveLength(32);
expect(Array.from(key).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('f30653dfd9862bb061fa8628134c672245db078e2ddba93508e856b5b762802b');
// boxKeyPairFromSeed：先 SHA-512 取前 32 字节再 X25519
const kp = boxKeyPairFromSeed(key);
// 官方向量：contentPub = 1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c
expect(Array.from(kp.publicKey).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c');
// 不同 usage 产生不同 key
const other = await deriveKey(ms, 'Other Usage', ['content']);
expect(other).not.toEqual(key);
```

- [ ] **Step 6: 运行测试确认失败**

- [ ] **Step 7: 实现 deriveKey.ts**

HMAC-SHA512 密钥树（Web Crypto）+ `boxKeyPairFromSeed`（**SHA-512(seed) → 取前 32 字节 → `tweetnacl.box.keyPair.fromSecretKey`**）。

- [ ] **Step 8: 运行测试确认通过**

- [ ] **Step 9: 写 encryptDataKey.test.ts 失败测试（固定向量）**

```ts
import { encryptDataKey, decryptDataKey, boxEncrypt, boxDecrypt } from './encryptDataKey';
// 固定向量（官方 CLI encryptWithDataKey 生成，aesKey = 32 字节全 0xCD）
const aesKey = new Uint8Array(32).fill(0xcd);
const msg = { role: 'user', content: { type: 'text', text: 'vector-test' } };
const bundle = await encryptDataKey(msg, aesKey);
// 官方向量：AES_MSG_BUNDLE 前 8 字节 = 00ef4b5cffaf9682
expect(bundle[0]).toBe(0); // version byte
expect(Array.from(bundle.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('00ef4b5cffaf9682');
expect(bundle.length).toBe(91); // 官方向量长度
const decrypted = await decryptDataKey(bundle, aesKey);
expect(decrypted).toEqual(msg);
const wrongKey = new Uint8Array(32).fill(0x11);
expect(await decryptDataKey(bundle, wrongKey)).toBeNull();
// boxEncrypt 格式测试（不验证与 CLI 的互通，互通在 Task 7 e2e）
import tweetnacl from 'tweetnacl';
const recipientKp = tweetnacl.box.keyPair();
const data = new Uint8Array([0x00, ...new Uint8Array(32).fill(0x42)]);
const { bundle: boxBundle } = boxEncrypt(data, recipientKp.publicKey);
expect(boxBundle.length).toBe(32 + 24 + 33 + 16);
const dec = boxDecrypt(boxBundle, recipientKp.secretKey);
expect(dec).toEqual(data);
```

- [ ] **Step 10: 运行测试确认失败**

- [ ] **Step 11: 实现 encryptDataKey.ts**

AES-GCM bundle = version(1)=0 || nonce(12) || ct || tag(16)。boxEncrypt 直接用 tweetnacl.box，格式与 CLI `libsodiumEncryptForPublicKey` 一致（ephemeralPub(32) || nonce(24) || ct）。boxDecrypt 反向。

- [ ] **Step 12: 运行测试确认通过**

- [ ] **Step 13: 提交**

```bash
git add packages/agentport-web/src/lib/
git commit -m "feat(agentport-web): crypto primitives — base64, HMAC-SHA512 deriveKey, boxKeyPairFromSeed (SHA-512→X25519), AES-GCM dataKey, tweetnacl box"
```

**Reviewer 卡点 1 的验证项**：`boxKeyPairFromSeed` 的官方派生向量（`1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c`）必须通过。Task 4 的真实 CLI V2 配对在 Task 7 e2e 验证。

---

### Task 3: 账户创建与恢复 — POST /v1/auth + content 公钥对

**Files:**
- Create: `packages/agentport-web/src/lib/authApi.ts`
- Create: `packages/agentport-web/src/lib/account.ts`
- Create: `packages/agentport-web/src/pages/LoginPage.tsx`（替换占位）
- Create: `packages/agentport-web/src/pages/RestorePage.tsx`（替换占位）
- Test: `packages/agentport-web/src/lib/account.test.ts`

**Interfaces:**
- Produces: `createAccount(masterSecret: Uint8Array): Promise<{token: string}>`（POST /v1/auth，tweetnacl.sign 签 challenge）
- Produces: `recoverAccount(masterSecret: Uint8Array): Promise<{token: string}>`（同上）
- Produces: `masterSecretToRecoveryCredential(ms: Uint8Array): string`（base64url）
- Produces: `recoveryCredentialToMasterSecret(s: string): Uint8Array|null`（非 32 字节返回 null）
- Produces: `deriveContentKeyPair(masterSecret: Uint8Array): Promise<tweetnacl.BoxKeyPair>`（`deriveKey` → `boxKeyPairFromSeed`，与 Task 2 相同路径）
- Produces: `Account` 类型：`{ masterSecret: Uint8Array; token: string }`
- Consumes: Task 2 的 base64, deriveKey, boxKeyPairFromSeed; tweetnacl.sign

- [ ] **Step 1: 写 account.test.ts 失败测试（固定向量）**

```ts
import { masterSecretToRecoveryCredential, recoveryCredentialToMasterSecret, deriveContentKeyPair } from './account';
const ms = new Uint8Array(32).fill(0xab);
const cred = masterSecretToRecoveryCredential(ms);
expect(recoveryCredentialToMasterSecret(cred)).toEqual(ms);
expect(recoveryCredentialToMasterSecret('too-short')).toBeNull();
// 官方向量：contentPub = 1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c
const kp = await deriveContentKeyPair(ms);
expect(Array.from(kp.publicKey).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c');
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 account.ts**

`deriveContentKeyPair` = `deriveKey(master, 'Happy EnCoder', ['content'])` → `boxKeyPairFromSeed`。
`createAccount` / `recoverAccount`：生成 32 字节随机 challenge，`tweetnacl.sign.keyPair.fromSeed(masterSecret)` 签 challenge，POST /v1/auth。

- [ ] **Step 4: 实现 authApi.ts**

POST /v1/auth，base64url 编码 publicKey/challenge/signature。

- [ ] **Step 5: 实现 LoginPage.tsx**

按钮"创建账户" → 生成 32 字节 masterSecret → createAccount → 显示恢复凭据（base64url）→ 存 IndexedDB → 跳转 `#home`。

- [ ] **Step 6: 实现 RestorePage.tsx**

输入框 → recoveryCredentialToMasterSecret → recoverAccount → 存 IndexedDB → 跳转 `#home`。无效凭据显示错误。

- [ ] **Step 7: 运行测试确认通过**

- [ ] **Step 8: 提交**

```bash
git add packages/agentport-web/src/
git commit -m "feat(agentport-web): account create/restore via POST /v1/auth, content keypair with official SHA-512→X25519 vector"
```

---

### Task 4: V2 终端配对 — /terminal/connect 页面

**Files:**
- Create: `packages/agentport-web/src/lib/terminalAuth.ts`
- Modify: `packages/agentport-web/src/pages/TerminalConnectPage.tsx`（替换占位）
- Test: `packages/agentport-web/src/lib/terminalAuth.test.ts`

**Interfaces:**
- Produces: `checkTerminalAuthStatus(pubKey: Uint8Array): Promise<{status: 'pending'|'authorized'|'not_found'; supportsV2: boolean}>`（GET /v1/auth/request/status）
- Produces: `approveTerminalV2(masterSecret: Uint8Array, ephemeralPub: Uint8Array, token: string): Promise<void>`（POST /v1/auth/response，response = box(0x00 || contentPub, ephemeralPub)）
- Consumes: Task 2 的 boxEncrypt, Task 3 的 deriveContentKeyPair, account (token)

- [ ] **Step 1: 写 terminalAuth.test.ts 失败测试（固定向量）**

```ts
import tweetnacl from 'tweetnacl';
import { approveTerminalV2 } from './terminalAuth';
import { decodeBase64 } from './base64';
import { boxDecrypt } from './encryptDataKey';
import { deriveContentKeyPair } from './account';

// 固定向量（官方 CLI 生成）
const ms = new Uint8Array(32).fill(0xab);
const ephSec = new Uint8Array(32).fill(0x11);
const eph = tweetnacl.box.keyPair.fromSecretKey(ephSec);
// 官方向量：ephemeralPub = 7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13
expect(Array.from(eph.publicKey).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('7b4e909bbe7ffe44c465a220037d608ee35897d31ef972f07f74892cb0f73f13');
const contentKp = await deriveContentKeyPair(ms);
// 官方向量：contentPub = 1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c
expect(Array.from(contentKp.publicKey).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c');

// mock fetch
let captured: any = {};
global.fetch = vi.fn().mockImplementation(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true }) }));

await approveTerminalV2(ms, eph.publicKey, 'test-token');

expect(captured.url).toBe('/v1/auth/response');
const resp = decodeBase64(captured.body.response, 'base64url');
const opened = boxDecrypt(resp, eph.secretKey);
expect(opened![0]).toBe(0x00);
expect(Array.from(opened!.slice(1, 33)).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c');
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 terminalAuth.ts**

`approveTerminalV2`：deriveContentKeyPair(masterSecret) → boxEncrypt([0x00, ...contentPublicKey], ephemeralPub) → POST /v1/auth/response {publicKey, response}。token 从 IndexedDB 读。

- [ ] **Step 4: 实现 TerminalConnectPage.tsx**

从 hash 解析 `#key=<base64url>` → checkTerminalAuthStatus → pending 时显示设备名 + 授权按钮 → approveTerminalV2 → 成功后跳转 `#home`。**not_found 显示"请求不存在或已过期，请在电脑上重新运行 auth login"，不循环重试**（服务端无 age 检查，not_found 只表示请求不存在；CLI 端轮询超时是客户端行为，与 not_found 分开）。authorized 显示"已授权"。

- [ ] **Step 5: 提交**

```bash
git add packages/agentport-web/src/
git commit -m "feat(agentport-web): V2 terminal pairing with official vectors, not_found shows non-retrying message (separate from server expiry)"
```

**Reviewer 卡点 1 的另一半**：Task 7 e2e 验证真实 CLI V2 配对（Node 脚本模拟 CLI + 浏览器 approveTerminalV2 的端到端）。

---

### Task 5: 会话 API + V3 消息编解码 + legacy 检测

**Files:**
- Create: `packages/agentport-web/src/lib/sessionApi.ts`
- Create: `packages/agentport-web/src/lib/messageCodec.ts`
- Test: `packages/agentport-web/src/lib/messageCodec.test.ts`

**Interfaces:**
- Produces: `fetchSessions(token: string): Promise<SessionSummary[]>`（GET /v1/sessions）
- Produces: `fetchMessagesV3(token: string, sessionId: string, afterSeq: number): Promise<{messages: SessionMessage[]; hasMore: boolean}>`（GET /v3/sessions/:id/messages?after_seq=N&limit=100）
- Produces: `sendMessageV3(token: string, sessionId: string, encrypted: string, localId: string): Promise<void>`（POST /v3/sessions/:id/messages，body {messages:[{content,localId}]}）
- Produces: `SessionSummary` 类型：`{id, tag, dataEncryptionKey: string|null, createdAt, updatedAt, active}`
- Produces: `unwrapDataKey(bundle: Uint8Array, contentSecretKey: Uint8Array): Uint8Array|null`（boxDecrypt，返回 32 字节 AES key）
- Produces: `decryptMessage(encCiphertext: Uint8Array, aesKey: Uint8Array): Promise<any|null>`（**直接用 aesKey 做 AES-GCM，不 deriveKey**）
- Produces: `encryptMessage(content: unknown, aesKey: Uint8Array): Promise<Uint8Array>`（同上）
- Produces: `isLegacySession(s: SessionSummary): boolean`（dataEncryptionKey === null）
- Consumes: Task 2 的 decryptDataKey, boxDecrypt; Task 3 的 deriveContentKeyPair; happy-wire 的 SessionMessageSchema, MessageContentSchema

**关键约束：消息 AES-GCM 直接用 box 解封后的原始 AES 密钥，不做第二层 deriveKey。`deriveKey(aesKey, 'Happy Blobs', ['session'])` 是 CLI `getBlobKey()` 给附件用的，不是消息用的。**

- [ ] **Step 1: 写 messageCodec.test.ts 失败测试（固定向量）**

```ts
import { encryptMessage, decryptMessage, unwrapDataKey, isLegacySession } from './messageCodec';
import { decodeBase64 } from './base64';

// 消息 AES-GCM 固定向量（官方 CLI encryptWithDataKey 生成）
const aesKey = new Uint8Array(32).fill(0xcd);
const msg = { role: 'user', content: { type: 'text', text: 'vector-test' } };
const enc = await encryptMessage(msg, aesKey);
// 官方向量：AES_MSG_BUNDLE 前 8 字节 = 00ef4b5cffaf9682
expect(enc[0]).toBe(0);
expect(Array.from(enc.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(''))
  .toBe('00ef4b5cffaf9682');
expect(enc.length).toBe(91);
const dec = await decryptMessage(enc, aesKey);
expect(dec).toEqual(msg);
const wrongKey = new Uint8Array(32).fill(0x11);
expect(await decryptMessage(enc, wrongKey)).toBeNull();

// legacy 检测
expect(isLegacySession({ id: 'x', tag: 't', dataEncryptionKey: null, createdAt: 0, updatedAt: 0, active: false })).toBe(true);
expect(isLegacySession({ id: 'x', tag: 't', dataEncryptionKey: 'abc', createdAt: 0, updatedAt: 0, active: false })).toBe(false);

// unwrapDataKey 格式测试（真实互通向量在 Task 7 e2e）
import { boxDecrypt } from './encryptDataKey';
import tweetnacl from 'tweetnacl';
const kp = tweetnacl.box.keyPair();
const aes = new Uint8Array(32).fill(0xaa);
const boxBundle = (() => {
  const eph = tweetnacl.box.keyPair();
  const nonce = tweetnacl.randomBytes(tweetnacl.box.nonceLength);
  const ct = tweetnacl.box(aes, nonce, kp.publicKey, eph.secretKey);
  const out = new Uint8Array(32 + 24 + ct.length);
  out.set(eph.publicKey, 0); out.set(nonce, 32); out.set(ct, 56);
  return out;
})();
const deks = new Uint8Array(1 + boxBundle.length);
deks.set([0], 0); deks.set(boxBundle, 1);
expect(unwrapDataKey(deks, kp.secretKey)).toEqual(aes);
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 messageCodec.ts**

`unwrapDataKey`：校验 version byte 0 → boxDecrypt(bundle[1:], contentSecretKey) → 32 字节 AES key。
`decryptMessage`：**直接用 aesKey 做 AES-GCM**（`decryptDataKey(aesKey, enc)`），不 deriveKey。
`encryptMessage`：`encryptDataKey(aesKey, content)`。
`isLegacySession`：`s.dataEncryptionKey === null`。

- [ ] **Step 4: 实现 sessionApi.ts**

`fetchSessions`：GET /v1/sessions，Bearer token，返回 SessionSummary[]。
`fetchMessagesV3`：GET /v3/sessions/:id/messages?after_seq=N&limit=100，返回 {messages, hasMore}。
`sendMessageV3`：POST /v3/sessions/:id/messages，body {messages: [{content, localId}]}。

- [ ] **Step 5: 运行测试确认通过**

- [ ] **Step 6: 提交**

```bash
git add packages/agentport-web/src/lib/
git commit -m "feat(agentport-web): session API, V3 message routes, dataKey unwrap, AES-GCM message codec (direct, no second deriveKey), legacy detection"
```

**Reviewer 卡点 2 的一半**：消息编解码用原始 AES key（不做第二层 deriveKey），V3 路由。Task 7 e2e 验证 CLI 与浏览器双向加解密互通。

---

### Task 6: 工作台 + 会话详情 + Socket.IO 实时消息

**Files:**
- Create: `packages/agentport-web/src/lib/socketClient.ts`
- Modify: `packages/agentport-web/src/pages/WorkbenchPage.tsx`（替换占位）
- Modify: `packages/agentport-web/src/pages/SessionDetailPage.tsx`（替换占位）

**Interfaces:**
- Produces: `createUserSocket(token: string): Promise<Socket>`（socket.io，clientType='user-scoped'，path='/v1/updates'）
- Produces: `createSessionSocket(token: string, sessionId: string): Promise<Socket>`（clientType='session-scoped'）
- Consumes: Task 3 的 account, Task 5 的 sessionApi, messageCodec; happy-wire MessageContentSchema

- [ ] **Step 1: 实现 socketClient.ts**

```ts
import { io, Socket } from 'socket.io-client';
export function createSessionSocket(token: string, sessionId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(window.location.origin, {
      auth: { token, clientType: 'session-scoped', sessionId },
      path: '/v1/updates',
      transports: ['websocket'],
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
  });
}
```

- [ ] **Step 2: 实现 WorkbenchPage.tsx**

读 IndexedDB 中的 account → fetchSessions（GET /v1/sessions）→ 显示设备列表（GET /v1/machines）和会话列表。每个会话显示 tag、活跃状态、更新时间。点击跳转 `#session/:id`。无会话时显示空状态。

- [ ] **Step 3: 实现 SessionDetailPage.tsx**

读 account → fetchSession → unwrapDataKey → 如果是 legacy（dataEncryptionKey === null）显示"此会话由旧版设备创建，暂不支持"并禁用所有操作。**不尝试用 tweetnacl.secretbox 解密。** 否则 fetchMessagesV3 → 解密每条（直接用 aesKey）→ 用 MessageContentSchema 解析 → 按 role 渲染。底部输入框 + 发送按钮 → encryptMessage → sendMessageV3。subscribe session socket → 收到 new-message → 解密 → 追加。用 seq 去重。

- [ ] **Step 4: 提交**

```bash
git add packages/agentport-web/src/
git commit -m "feat(agentport-web): workbench device/session list, session detail with V3 messages, legacy disabled state, Socket.IO real-time"
```

**Reviewer 卡点 2 的另一半**：Task 7 e2e 验证 CLI 与浏览器双向加解密 + V3 消息收发。

---

### Task 7: 端到端集成验证 — 真实 CLI V2 配对 + V3 双向消息 + 恢复凭据

**Files:**
- Create: `packages/agentport-web/scripts/e2e-interop.test.ts`
- Create: `packages/agentport-web/scripts/run-selfhost.sh`

**Interfaces:**
- Consumes: 所有前序任务
- Produces: 可重复的 e2e 测试命令和自托管启动脚本
- **Reviewer 三道验收卡点的终点：**
  1. Task 2–4 的官方派生向量和真实 CLI V2 配对（本任务 Step 5）
  2. Task 5–6 的 CLI 与浏览器双向加解密及 V3 消息收发（本任务 Step 6–7）
  3. 本任务的干净配置端到端 + 第二浏览器恢复同一会话（本任务 Step 8）

- [ ] **Step 1: 写 run-selfhost.sh**

```bash
#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="${1:-/tmp/agentport-e2e-data}"
export DATA_DIR="$DATA_DIR" PGLITE_DIR="$DATA_DIR/pglite" DB_PROVIDER=pglite
export HANDY_MASTER_SECRET="${HANDY_MASTER_SECRET:-e2e-test-secret}"
export HOST=127.0.0.1 PORT="${PORT:-3005}"
export HAPPY_STATIC_DIR="$SCRIPT_DIR/dist"
node "$REPO_ROOT/packages/happy-server-self-host/dist/standalone.mjs" migrate
exec node "$REPO_ROOT/packages/happy-server-self-host/dist/standalone.mjs" serve
```

- [ ] **Step 2: 构建 Web 产物 + 启动 Self-host Server**

`pnpm --filter agentport-web build` → `bash scripts/run-selfhost.sh`（后台）。等待 /health ok。

- [ ] **Step 3: 验证静态托管**

`curl http://127.0.0.1:3005/terminal/connect` → 返回 index.html。

- [ ] **Step 4: 验证 POST /v1/auth（真实 Node 脚本）**

用 tweetnacl.sign.keyPair.fromSeed 签名，POST /v1/auth，预期 `{success: true, token: '...'}`。

- [ ] **Step 5: 验证真实 CLI V2 配对（reviewer 卡点 1）**

Node 脚本模拟 CLI：生成临时 box keypair → POST /v1/auth/request {supportsV2: true} → 等待 → Node 脚本模拟浏览器 approveTerminalV2（用 Task 2 的 boxEncrypt，contentPub 用官方向量 `1e62c410ff03e83e4a3157f5af8db6c4f792534aafa39793cc76f1c2d71a882c`）→ CLI 轮询得到 response → boxDecrypt 验证 `0x00 || contentPub` 匹配官方向量。

- [ ] **Step 6: 验证 dataKey 会话创建 + 浏览器解密（reviewer 卡点 2）**

CLI 脚本：随机 32 字节 AES key → box(aesKey, contentPub) ��� POST /v1/sessions {tag, metadata, dataEncryptionKey}。浏览器脚本（Node 模拟）：GET /v1/sessions → unwrapDataKey → **fetchMessagesV3** → decryptMessage（直接用 aesKey，不 deriveKey）→ 验证消息内容匹配。

- [ ] **Step 7: 验证 V3 消息双向收发**

浏览器 POST message（sendMessageV3）→ CLI socket 收到并解密。CLI socket 发 message → 浏览器收到并解密。用 seq 号去重。验证 AES-GCM bundle 格式（version || nonce || ct || tag）。

- [ ] **Step 8: 验证恢复凭据在第二"浏览器"恢复（reviewer 卡点 3）**

用 Node 脚本解码恢复凭据 → POST /v1/auth → 得到新 token → GET /v1/sessions → 看到同一会话 → 解密历史成功。

- [ ] **Step 9: 提交**

```bash
git add packages/agentport-web/scripts/
git commit -m "test(agentport-web): e2e interop — real CLI V2 pairing, V3 message roundtrip, recovery credential in second browser"
```

---

### Task 8: 页面状态打磨 — 加载、空列表、错误、legacy 提示、配对过期

**Files:**
- Modify: `packages/agentport-web/src/pages/WorkbenchPage.tsx`
- Modify: `packages/agentport-web/src/pages/SessionDetailPage.tsx`
- Modify: `packages/agentport-web/src/pages/LoginPage.tsx`
- Modify: `packages/agentport-web/src/pages/RestorePage.tsx`
- Modify: `packages/agentport-web/src/pages/TerminalConnectPage.tsx`

**Interfaces:**
- Produces: 每个页面的 loading/error/empty 三态
- Produces: legacy 会话的"暂不支持"禁用态
- Produces: 配对不可用（`not_found`）提示，与服务端强制过期分开

- [ ] **Step 1: WorkbenchPage 空状态**

无会话时显示"暂无会话，在电脑上启动 Agent 后会自动出现"。无设备时显示"尚未配对设备"。

- [ ] **Step 2: SessionDetailPage legacy 禁用态**

`dataEncryptionKey === null` 时：显示"此会话由旧版设备创建，暂不支持"，输入框 disabled，历史不加载。**不尝试用 tweetnacl.secretbox 解密。**

- [ ] **Step 3: TerminalConnectPage 过期态**

status 返回 `not_found` 时显示"配对请求不存在或已过期，请在电脑上重新运行 auth login"。**不循环重试**，不与服务端强制过期逻辑混淆（服务端无 age 检查，`not_found` 只表示请求不存在）。

- [ ] **Step 4: 提交**

```bash
git add packages/agentport-web/src/pages/
git commit -m "feat(agentport-web): page states — loading, empty, error, legacy disabled, terminal-connect not_found (no retry, separate from server expiry)"
```

---

### Task 9: 交付与阶段 2 交接清单

**Files:**
- Modify: `packages/agentport-web/README.md`（React 版 + 构建/启动/e2e 命令 + 待接入清单）

**Interfaces:**
- Consumes: 所有前序任务
- Produces: 交付物（可重复命令 + 互通证据 + 待接入清单）

CLI 改造（agentport 命令、默认域名、Web-only 登录）属实施计划阶段 2，本阶段不动。

- [ ] **Step 1: 更新 README.md**

文档化：构建命令、启动命令、e2e 测试命令、`HAPPY_STATIC_DIR` 配置。列出待接入功能清单：浏览器远程创建会话（spawn-happy-session RPC）、工具批准与拒绝、断线补拉、设备撤销、legacy 会话兼容。

- [ ] **Step 2: 提交**

```bash
git add packages/agentport-web/
git commit -m "docs(agentport-web): README with build/run/e2e commands and phase-2 handoff list"
```
