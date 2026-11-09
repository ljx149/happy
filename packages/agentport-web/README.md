# AgentPort Web · Phase 1

浏览器客户端接入锁定版本的 Happy 自托管服务。首阶段支持账户创建与恢复、V2 终端配对、设备和会话列表、dataKey 历史消息和双向收发。legacy 会话可见，详情提示暂不支持。

从工作区根目录构建：

```sh
pnpm install --frozen-lockfile
pnpm --filter @slopus/happy-wire build
pnpm --filter agentport-web test
pnpm --filter agentport-web build
```

设置 `HAPPY_STATIC_DIR` 为 `packages/agentport-web/dist` 的绝对路径，按 Self-host 文档启动服务。Web 与 API 由同一地址提供。浏览器需要 HTTPS 或 localhost 才能使用 Web Crypto。

验证时使用新的浏览器上下文和独立的 CLI 配置目录。将 `HAPPY_SERVER_URL` 和 `HAPPY_WEBAPP_URL` 都指向同一测试服务，使用当前 CLI 的 Web 登录入口。创建账户后保存恢复凭据，打开终端提供的配对 URL，授权后在 CLI 本地创建会话。浏览器读取历史并发送消息，确认 CLI 能接收和回复。最后在独立浏览器上下文恢复同一账户并读取同一会话。

首阶段暂存恢复凭据于当前标签页的 sessionStorage，以支持刷新。关闭标签页后，可用恢复凭据重新登入。请勿在日志、截图或录屏中保留恢复凭据。

### 本机 Self-host 联调

构建 `happy-server-self-host` 后，使用新目录和该测试实例专用的 master secret：

```sh
export DATA_DIR="$(mktemp -d)"
export HANDY_MASTER_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
bash packages/agentport-web/scripts/run-selfhost.sh
```

### 端到端互通验证（可复跑）

在 `run-selfhost.sh` 起的 Self-host 服务就绪后（`curl localhost:3005/health` 返回 `{"status":"ok"}`），运行：

```sh
npx tsx packages/agentport-web/scripts/e2e-interop.mts --base http://localhost:3005
```

脚本直接 import `src/lib/protocol.ts` 和 `src/lib/api.ts`（无重实现），依次验证：官方派生向量 → 账户创建 → V2 终端配对（box 解出 `0x00||contentPub`）→ dataKey 会话创建 → 浏览器解封 AES key 解密历史 → 双向消息收发（V3 路由）→ Socket.IO 实时投递 + seq 去重 → 恢复凭据在第二浏览器恢复同一账户同一会话。全部通过打印 `✓ all e2e checks passed`，任一失败退出码 1。

下一阶段接入浏览器远程创建会话、工具审批和服务端设备撤销。CLI 品牌、默认域名和 Web-only 登录另行交付。
