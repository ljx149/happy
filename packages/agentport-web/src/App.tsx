import { useEffect, useState, type FormEvent } from 'react';
import * as api from './lib/api.ts';
import { contentKeys, decode, encode } from './lib/protocol.ts';
import { errorText, type Account } from './lib/account.ts';
import { LoginPage } from './pages/LoginPage';
import { RestorePage } from './pages/RestorePage';
import { TerminalConnectPage } from './pages/TerminalConnectPage';
import { WorkbenchPage } from './pages/WorkbenchPage';
import { SessionDetailPage } from './pages/SessionDetailPage';

type Route =
  | { page: 'terminal-connect'; key: string | undefined }
  | { page: 'restore' }
  | { page: 'session-detail'; id: string }
  | { page: 'workbench' }
  | { page: 'login' };

function route(): Route {
  const { pathname, hash } = window.location;
  if (pathname === '/terminal/connect') return { page: 'terminal-connect', key: hash.replace('#key=', '') || undefined };
  if (hash === '#restore') return { page: 'restore' };
  if (hash.startsWith('#session/')) return { page: 'session-detail', id: hash.split('/')[2] };
  if (hash === '#home') return { page: 'workbench' };
  return { page: 'login' };
}

export default function App() {
  const [r, setR] = useState(route);
  const [account, setAccount] = useState<Account>();
  const [backup, setBackup] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const fn = () => setR(route());
    window.addEventListener('hashchange', fn);
    return () => window.removeEventListener('hashchange', fn);
  }, []);

  useEffect(() => {
    let current = true;
    const saved = sessionStorage.getItem('agentport.phase1.recovery');
    if (saved) {
      setBusy(true);
      Promise.resolve().then(() => {
        const master = decode(saved);
        if (master.length !== 32) throw new Error('恢复凭据格式不正确');
        return Promise.all([api.authenticate(master), contentKeys(master)]);
      }).then(([token, keys]) => {
        if (current) setAccount({ token, keys });
      }).catch(error => {
        if (current) setError(errorText(error));
      }).finally(() => {
        if (current) setBusy(false);
      });
    }
    return () => { current = false; };
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = new FormData(event.currentTarget).get('recovery');
    setBusy(true);
    setError('');
    try {
      const master = r.page === 'restore' ? decode(String(input).trim()) : crypto.getRandomValues(new Uint8Array(32));
      if (master.length !== 32) throw new Error('恢复凭据格式不正确');
      const [token, keys] = await Promise.all([api.authenticate(master), contentKeys(master)]);
      const recovery = encode(master, true);
      sessionStorage.setItem('agentport.phase1.recovery', recovery);
      setAccount({ token, keys });
      if (r.page !== 'restore') setBackup(recovery);
      if (r.page !== 'terminal-connect') location.hash = 'home';
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    sessionStorage.removeItem('agentport.phase1.recovery');
    setAccount(undefined);
    setBackup('');
  }

  return <>
    <header className="topbar">
      <a className="brand" href="/" aria-label="AgentPort 工作台">›_ AgentPort</a>
      {account && <button className="quiet" onClick={logout}>退出</button>}
    </header>
    <main id="screen">
      {!account ? (
        r.page === 'restore'
          ? <RestorePage busy={busy} error={error} onSubmit={login} />
          : <LoginPage busy={busy} error={error} onSubmit={login} />
      ) : backup ? (
        <section className="page">
          <div className="hero"><span className="eyebrow">AGENTPORT</span><h1>保存恢复凭据</h1><p>换浏览器时用此凭据恢复账户和加密会话。</p></div>
          <div className="panel stack"><code className="readout">{backup}</code>
            <button className="primary" onClick={() => setBackup('')}>已保存，继续</button>
          </div>
        </section>
      ) : r.page === 'terminal-connect' ? (
        <TerminalConnectPage account={account} key_={r.key} />
      ) : r.page === 'session-detail' ? (
        <SessionDetailPage account={account} id={r.id} />
      ) : (
        <WorkbenchPage account={account} />
      )}
    </main>
  </>;
}
