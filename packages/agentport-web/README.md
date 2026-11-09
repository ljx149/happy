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

### 端到端互通验证（可复跑）

在 `run-selfhost.sh` 起的 Self-host 服务就绪后（`curl localhost:3005/health` 返回 `{"status":"ok"}`），运行：

```sh
node packages/agentport-web/scripts/e2e-interop.mjs --base http://localhost:3005
```

脚本依次验证：账户创建（POST /v1/auth）→ V2 终端配对（box 解出 `0x00||contentPub`）→ dataKey 会话创建 → 浏览器解封 AES key 解密历史 → 双向消息收发（V3 路由）→ 恢复凭据在第二浏览器恢复同一账户同一会话。全部通过打印 `✓ all e2e checks passed`，任一失败退出码 1。API 体用标准 base64（与 CLI 的 `encodeBase64` 默认一致），恢复凭据验收比较 JWT `sub`（账户主体）而非 token 字符串——服务端每次 authenticate 签发新 JWT。

下一阶段接入浏览器远程创建会话、工具审批和服务端设备撤销。CLI 品牌、默认域名和 Web-only 登录另行交付。

### 本机 Self-host 联调

构建 `happy-server-self-host` 后，使用新目录和该测试实例专用的 master secret：

```sh
export DATA_DIR="$(mktemp -d)"
export HANDY_MASTER_SECRET="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
bash packages/agentport-web/scripts/run-selfhost.sh
```

本次验收使用真实浏览器和锁定版 `happy auth login` 的 Web 选项完成 V2 配对。随后使用 Happy CLI 的实际 Session Client 创建会话并以测试消息验证双向收发，再用独立浏览器上下文恢复并读取历史。测试会话用确定性回复验证传输，不调用外部模型。

### 端到端互通验证（可复跑）

在 `run-selfhost.sh` 起的 Self-host 服务就绪后（`curl localhost:3005/health` 返回 `{"status":"ok"}`），运行：

```sh
node packages/agentport-web/scripts/e2e-interop.mjs --base http://localhost:3005
```

脚本依次验证：账户创建（POST /v1/auth）→ V2 终端配对（box 解出 `0x00||contentPub`）→ dataKey 会话创建 → 浏览器解封 AES key 解密历史 → 双向消息收发（V3 路由）→ 恢复凭据在第二浏览器恢复同一账户同一会话。API 体用标准 base64（与 CLI 的 `encodeBase64` 默认一致）。恢复凭据验收比较 JWT `sub`（账户主体）而非 token 字符串——服务端每次 authenticate 签发新 JWT。全部通过打印 `✓ all e2e checks passed`，任一失败退出码 1。
