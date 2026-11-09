import { useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import * as api from '../lib/api.ts';
import { errorText, field, sessionSummaries, type Account } from '../lib/account.ts';

type Summary = api.RecordSummary & { title: string };

export function WorkbenchPage({ account }: { account: Account }) {
  const [records, setRecords] = useState<{ sessions: Summary[]; devices: Summary[] }>();
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [sessions, machines] = await Promise.all([api.sessions(account.token), api.machines(account.token)]);
        const [sessionList, devices] = await Promise.all([
          sessionSummaries(sessions.sessions, account, '会话'),
          sessionSummaries(machines, account, '电脑'),
        ]);
        if (active) {
          setRecords({ sessions: sessionList, devices });
          setError('');
        }
      } catch (error) {
        if (active) setError(errorText(error));
      }
    }
    const socket = io({ path: '/v1/updates', auth: { token: account.token, clientType: 'user-scoped' } });
    void refresh();
    socket.on('connect', refresh);
    socket.on('update', update => {
      const type = field(field(update, 'body'), 't');
      if (type !== 'new-message') void refresh();
    });
    return () => { active = false; socket.disconnect(); };
  }, [account]);

  return <div className="layout workspace">
    <aside className="sidebar">
      <a className="back" href="#home">工作台</a>
      <h2>最近会话</h2>
      {records && records.sessions.length ? records.sessions.map(session =>
        <a key={session.id} className="row" href={'#session/' + session.id}>
          <span>{session.title}</span>
          {session.dataEncryptionKey === null && <span className="status">旧格式</span>}
        </a>) : <p>暂无会话，请先在已连接的电脑上启动 CLI 会话。</p>}
    </aside>
    <section className="page">
      <div className="hero"><span className="eyebrow">AGENTPORT</span><h1>工作台</h1><p>在浏览器里继续电脑上的开发任务。</p></div>
      {error && <p role="alert" className="pending">{error}</p>}
      {!records && !error && <p role="status">正在同步工作台…</p>}
      {records && <div className="stack">
        <section className="panel"><h2>设备</h2>
          {records.devices.length ? records.devices.map(device => <div className="row" key={device.id}>
            <span>{device.title}</span><span className={device.active ? 'status online' : 'status'}>{device.active ? '● 在线' : '离线'}</span>
          </div>) : <p>暂无设备。请在电脑上运行 CLI 登录，打开终端给出的配对链接。</p>}
        </section>
        <section className="panel"><h2>最近会话</h2>
          {records.sessions.length ? records.sessions.map(session =>
            <a key={session.id} className="row" href={'#session/' + session.id}>
              <span>{session.title}</span>
              {session.dataEncryptionKey === null && <span className="status">旧格式</span>}
            </a>) : <p>暂无会话。</p>}
        </section>
      </div>}
    </section>
  </div>;
}
