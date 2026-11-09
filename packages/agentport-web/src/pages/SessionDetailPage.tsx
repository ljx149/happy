import { useEffect, useState, type FormEvent } from 'react';
import { io } from 'socket.io-client';
import { MessageContentSchema, UserMessageSchema } from '@slopus/happy-wire';
import * as api from '../lib/api.ts';
import { decryptRecord, encryptRecord, unwrapKey } from '../lib/protocol.ts';
import { errorText, field, messageText, type Account } from '../lib/account.ts';

type Message = { id: string; author: string; text: string };

export function SessionDetailPage({ account, id }: { account: Account; id: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [syncError, setSyncError] = useState('');
  const [sendError, setSendError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [refresh, setRefresh] = useState<() => void>();
  const [title, setTitle] = useState(id.slice(0, 8));

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
    void sync();
    socket.on('connect', sync);
    socket.on('update', update => {
      const body = field(update, 'body');
      if (field(body, 't') === 'new-message' && field(body, 'sid') === id) void sync();
    });
    return () => { active = false; socket.disconnect(); };
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

  return <section className="page chat">
    <header className="chat-head"><a className="back mobile-only" href="#home">‹ 工作台</a>
      <span className="eyebrow">SESSION</span><h1>{title}</h1>
    </header>
    <div className="thread" aria-label="会话消息" aria-live="polite">
      {syncError && <p role="alert" className="pending">{syncError}</p>}
      {!loaded && !syncError && <p role="status">正在同步会话…</p>}
      {loaded && !messages.length && <p>暂无消息。</p>}
      {messages.map(message => <div className="message" key={message.id} data-author={message.author}>
        <strong>{message.author}</strong>{message.text}
      </div>)}
    </div>
    {sendError && <p role="alert" className="pending">{sendError}</p>}
    <form className="composer" onSubmit={send}>
      <textarea aria-label="消息" rows={1} value={draft} onChange={event => setDraft(event.target.value)} placeholder="发送指令…" />
      <button className="primary" disabled={busy || !loaded || !draft.trim()}>发送 ↑</button>
    </form>
  </section>;
}
