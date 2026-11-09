import { useEffect, useState } from 'react';
import * as api from '../lib/api.ts';
import { decode } from '../lib/protocol.ts';
import { errorText, type Account } from '../lib/account.ts';

export function TerminalConnectPage({ account, key_ }: { account: Account; key_?: string }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.terminalStatus>>>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => {
    try {
      const value = decode(key_ ?? '');
      return value.length === 32 ? value : undefined;
    } catch {
      return undefined;
    }
  });

  useEffect(() => {
    if (!key) return;
    let active = true;
    api.terminalStatus(key).then(status => {
      if (active) setStatus(status);
    }).catch(error => {
      if (active) setError(errorText(error));
    });
    return () => { active = false; };
  }, [key]);

  async function approve() {
    if (!key) return;
    setBusy(true);
    setError('');
    try {
      await api.approveTerminal(account.token, key, account.keys.publicKey);
      setStatus({ status: 'authorized', supportsV2: true });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return <section className="page">
    <div className="hero"><span className="eyebrow">TERMINAL PAIRING</span><h1>连接电脑</h1><p>确认将发起请求的终端连接到此账户。</p></div>
    <div className="panel stack">
      {!key ? <p>链接无效，请在电脑上重新运行 auth login。</p> :
        status?.status === 'not_found' ? <p>请求不存在或已过期，请在电脑上重新运行 auth login。</p> :
        status?.status === 'authorized' ? <p className="online" role="status">终端已授权。</p> :
        status?.status === 'pending' && status.supportsV2 ?
          <button className="primary" disabled={busy} onClick={approve}>确认连接</button> :
        status?.status === 'pending' ? <p>此终端不支持 V2 配对。</p> : !error && <p>正在查询配对状态…</p>}
      {error && <p role="alert" className="pending">{error}</p>}
      <a className="back" href="/">返回工作台 ›</a>
    </div>
  </section>;
}
