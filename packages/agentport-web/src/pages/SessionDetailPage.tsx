import { useEffect, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import { MessageContentSchema, UserMessageSchema } from '@slopus/happy-wire';
import * as api from '../lib/api.ts';
import { decryptRecord, encryptRecord, unwrapKey } from '../lib/protocol.ts';
import { buildPermissionPayload, encodePermissionPayload, permissionRpcMethod, extractPendingRequests } from '../lib/permission.ts';
import { errorText, field, messageText, type Account } from '../lib/account.ts';

type Message = { id: string; author: string; text: string };

export function SessionDetailPage({ account, id }: { account: Account; id: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [syncError, setSyncError] = useState('');
  const [sendError, setSendError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [draft, setDraft] = useState('');
  const [refresh, setRefresh] = useState<() => void>();
  const [title, setTitle] = useState(id.slice(0, 8));
  const [permRequests, setPermRequests] = useState<Array<{ id: string; tool?: string; arguments?: unknown; createdAt?: number }>>([]);
  const [permError, setPermError] = useState('');
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());
  const socketRef = useRef<Socket | null>(null);
  const pendingPermIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    let cursor = 0;
    let running = false;
    let queued = false;
    const socket = io({ path: '/v1/updates', auth: { token: account.token, clientType: 'user-scoped' } });

    async function sync() {
      queued = true;
      if (running) return;
      running = true;
      try {
        // Resolve the wrapped data key once per session.
        const records = await api.sessions(account.token);
        const record = records.sessions.find(r => r.id === id);
        if (!record) throw new Error('找不到该会话。');
        const key = record.dataEncryptionKey ? unwrapKey(record.dataEncryptionKey, account.keys.secretKey) : null;
        if (!key) {
          // legacy session — visible in list, not supported here.
          setTitle('此会话使用 legacy 加密，暂不支持。');
          setLegacy(true);
          setLoaded(true);
          return;
        }
        while (active && queued) {
          queued = false;
          let more = true;
          while (active && more) {
            const page = await api.messages(account.token, id, cursor);
            const decoded = await Promise.all(page.messages.map(async message => {
              try {
                const value = await decryptRecord(message.content.c, key);
                const parsed = MessageContentSchema.safeParse(value);
                const content = parsed.success ? parsed.data : value;
                const role = field(content, 'role') === 'session' ? field(field(content, 'content'), 'role') : field(content, 'role');
                return { id: message.id, author: role === 'user' ? '你' : 'Agent', text: messageText(content) };
              } catch {
                return { id: message.id, author: '系统', text: '此消息无法解密。' };
              }
            }));
            if (!active) return;
            cursor = page.messages.at(-1)?.seq ?? cursor;
            more = page.hasMore && page.messages.length > 0;
            setMessages(current => [...current, ...decoded]);
          }
          setLoaded(true);
          setSyncError('');
        }
      } catch (error) {
        if (active) setSyncError(errorText(error));
      } finally {
        running = false;
      }
    }

    setRefresh(() => sync);
    async function syncPermissions() {
      try {
        const records = await api.sessions(account.token);
        const record = records.sessions.find(r => r.id === id);
        if (!record?.agentState || !record.dataEncryptionKey) { setPermRequests([]); return; }
        const key = unwrapKey(record.dataEncryptionKey, account.keys.secretKey);
        const state = await decryptRecord(record.agentState, key);
        const pending = extractPendingRequests(state).filter(p => !pendingPermIds.current.has(p.id));
        if (pending.length) setPermRequests(current => [...current, ...pending]);
      } catch {
        // agentState may be null or decrypt fail; leave requests untouched
      }
    }
    void sync();
    socket.on('connect', () => { void sync(); void syncPermissions(); });
    socket.on('update', update => {
      const body = field(update, 'body');
      const type = field(body, 't');
      if (type === 'new-message' && field(body, 'sid') === id) void sync();
      if (type === 'update-session' && field(body, 'sessionId') === id && field(field(body, 'agentState'), 'value')) void syncPermissions();
    });
    socketRef.current = socket;
    return () => { active = false; socket.disconnect(); socketRef.current = null; };
  }, [account, id]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !draft.trim()) return;
    setBusy(true);
    setSendError('');
    try {
      const records = await api.sessions(account.token);
      const record = records.sessions.find(r => r.id === id);
      if (!record?.dataEncryptionKey) throw new Error('此会话暂不支持发送。');
      const key = unwrapKey(record.dataEncryptionKey, account.keys.secretKey);
      const body = UserMessageSchema.parse({ role: 'user', content: { type: 'text', text: draft.trim() } });
      const encrypted = await encryptRecord(body, key);
      await api.sendMessage(account.token, id, encrypted, crypto.randomUUID());
      setDraft('');
      refresh?.();
    } catch (error) {
      setSendError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  async function resolvePermission(requestId: string, approved: boolean) {
    if (pendingPermIds.current.has(requestId)) return;
    pendingPermIds.current.add(requestId);
    setPermError('');
    try {
      const records = await api.sessions(account.token);
      const record = records.sessions.find(r => r.id === id);
      if (!record?.dataEncryptionKey) throw new Error('此会话暂不支持审批。');
      const key = unwrapKey(record.dataEncryptionKey, account.keys.secretKey);
      const payload = buildPermissionPayload({ id: requestId, approved, decision: approved ? undefined : 'denied' });
      const encrypted = await encodePermissionPayload(payload, key);
      const socket = socketRef.current;
      if (!socket) throw new Error('连接未建立。');
      const ack: { ok: boolean; result?: string; error?: string } = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('审批超时。')), 15_000);
        socket.timeout(15_000).emitWithAck('rpc-call', { method: permissionRpcMethod(id), params: encrypted }, (err: unknown, res: any) => {
          clearTimeout(timeout);
          if (err) reject(new Error(errorText(err)));
          else resolve(res);
        });
      });
      if (!ack.ok) throw new Error(ack.error ?? '审批请求被拒绝。');
      setPermRequests(current => current.filter(p => p.id !== requestId));
    } catch (error) {
      pendingPermIds.current.delete(requestId);
      setPermError(errorText(error));
    }
  }

  return <section className="page chat">
    <header className="chat-head"><a className="back mobile-only" href="#home">‹ 工作台</a>
      <span className="eyebrow">SESSION</span><h1>{title}</h1>
    </header>
    <div className="thread" aria-label="会话消息" aria-live="polite">
      {syncError && <p role="alert" className="pending">{syncError}</p>}
      {!loaded && !syncError && !legacy && <p role="status">正在同步会话…</p>}
      {loaded && legacy && <p role="status">此会话由旧版设备创建，使用 legacy 加密，当前浏览器客户端暂不支持读取或发送。可在工作台列表中查看，但无法在此对话。</p>}
      {loaded && !legacy && !messages.length && <p>暂无消息。</p>}
      {messages.map(message => <div className="message" key={message.id} data-author={message.author}>
        <strong>{message.author}</strong>{message.text}
      </div>)}
    </div>
    {permRequests.length > 0 && !legacy && <div className="perm-list" aria-label="待审批请求" aria-live="polite">
      {permRequests.map(req => <div className="perm" key={req.id}>
        <p>{req.tool ?? '未知工具'} · {typeof req.arguments === 'object' && req.arguments ? JSON.stringify(req.arguments).slice(0, 120) : ''}</p>
        <div className="perm-actions">
          <button className="primary" onClick={() => resolvePermission(req.id, true)} disabled={pendingPermIds.current.has(req.id)}>允许一次</button>
          <button onClick={() => resolvePermission(req.id, false)} disabled={pendingPermIds.current.has(req.id)}>拒绝</button>
        </div>
      </div>)}
    </div>}
    {permError && <p role="alert" className="pending">{permError}</p>}
    {sendError && <p role="alert" className="pending">{sendError}</p>}
    {!legacy && <form className="composer" onSubmit={send}>
      <textarea aria-label="消息" rows={1} value={draft} onChange={event => setDraft(event.target.value)} placeholder="发送指令…" />
      <button className="primary" disabled={busy || !loaded || !draft.trim()}>发送 ↑</button>
    </form>}
  </section>;
}
