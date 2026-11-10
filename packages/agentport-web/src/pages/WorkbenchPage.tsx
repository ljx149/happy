import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as api from '../lib/api.ts';
import { errorText, field, sessionSummaries, type Account } from '../lib/account.ts';
import { unwrapKey } from '../lib/protocol.ts';
import {
  buildSpawnParams,
  encodeSpawnParams,
  decodeSpawnResult,
  interpretSpawnResult,
  spawnRpcMethod,
  type SpawnInterpretation,
} from '../lib/spawn.ts';

type Summary = api.RecordSummary & { title: string };

type Device = api.RecordSummary & { title: string; agent: string };

export function WorkbenchPage({ account }: { account: Account }) {
  const [records, setRecords] = useState<{ sessions: Summary[]; devices: Device[] }>();
  const [error, setError] = useState('');
  const [machineId, setMachineId] = useState('');
  const [agent, setAgent] = useState('claude');
  const [directory, setDirectory] = useState('');
  const [directoryPending, setDirectoryPending] = useState<string | null>(null);
  const [spawnBusy, setSpawnBusy] = useState(false);
  const [spawnResult, setSpawnResult] = useState<SpawnInterpretation | null>(null);
  const [spawnError, setSpawnError] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const spawnedRef = useRef(false);

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
          setRecords({ sessions: sessionList, devices: devices as Device[] });
          setError('');
        }
      } catch (error) {
        if (active) setError(errorText(error));
      }
    }
    const socket = io({ path: '/v1/updates', auth: { token: account.token, clientType: 'user-scoped' } });
    socketRef.current = socket;
    void refresh();
    socket.on('connect', refresh);
    socket.on('update', update => {
      const type = field(field(update, 'body'), 't');
      if (type !== 'new-message') void refresh();
    });
    return () => { active = false; socket.disconnect(); };
  }, [account]);

  const availableDevices = useMemo(
    () => records?.devices.filter(device => device.active && device.dataEncryptionKey != null) ?? [],
    [records],
  );

  function machineKeyFor(machineId: string): Uint8Array<ArrayBuffer> | null {
    const device = records?.devices.find(d => d.id === machineId);
    if (!device?.dataEncryptionKey) return null;
    try {
      return unwrapKey(device.dataEncryptionKey, account.keys.secretKey);
    } catch {
      return null;
    }
  }

  async function doSpawn(machineId: string, approvedNewDirectoryCreation: boolean) {
    if (!machineId || !directory.trim()) return;
    const machineKey = machineKeyFor(machineId);
    if (!machineKey) {
      setSpawnError('设备密钥不可用，无法加密启动参数。');
      return;
    }
    const socket = socketRef.current;
    if (!socket) {
      setSpawnError('连接未建立，请稍候重试。');
      return;
    }
    setSpawnBusy(true);
    setSpawnError('');
    try {
      const encrypted = await encodeSpawnParams(
        buildSpawnParams({ directory: directory.trim(), agent, approvedNewDirectoryCreation }),
        machineKey,
      );
      const ack: { ok: boolean; result?: string; error?: string } = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('启动超时，结果未知。请刷新会话列表。')), 30_000);
        socket.timeout(30_000).emitWithAck('rpc-call', { method: spawnRpcMethod(machineId), params: encrypted }, (err: unknown, res: any) => {
          clearTimeout(timeout);
          if (err) reject(new Error(errorText(err)));
          else resolve(res);
        });
      });
      if (!ack.ok) {
        throw new Error(ack.error ?? '启动请求被拒绝。');
      }
      const decoded = await decodeSpawnResult(ack.result ?? '', machineKey);
      const interpretation = interpretSpawnResult(decoded);
      setSpawnResult(interpretation);
      if (interpretation.kind === 'success') {
        location.hash = `#session/${interpretation.sessionId}`;
      } else if (interpretation.kind === 'directory-approval') {
        setDirectoryPending(interpretation.directory);
      } else if (interpretation.kind === 'error') {
        setSpawnError(interpretation.message);
      } else {
        setSpawnError('启动结果未知，已刷新会话列表。');
      }
    } catch (error) {
      setSpawnError(errorText(error));
    } finally {
      setSpawnBusy(false);
    }
  }

  function submitSpawn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (spawnBusy || spawnedRef.current) return;
    if (spawnResult?.kind === 'success') return;
    if (!machineId || !directory.trim()) {
      setSpawnError('请选择设备和项目路径。');
      return;
    }
    spawnedRef.current = true;
    void doSpawn(machineId, false);
  }

  function confirmDirectoryCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (spawnBusy || directoryPending == null) return;
    const dir = directoryPending;
    setDirectoryPending(null);
    setSpawnResult(null);
    setDirectory(dir);
    void doSpawn(machineId, true);
  }

  function resetSpawn() {
    spawnedRef.current = false;
    setSpawnResult(null);
    setSpawnError('');
    setDirectoryPending(null);
  }

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
        <section className="panel"><h2>新建会话</h2>
          {spawnBusy && <p role="status">正在启动…</p>}
          {!spawnBusy && spawnResult?.kind === 'success' && <p role="status">已跳转到新会话。</p>}
          {!spawnBusy && spawnResult?.kind === 'unknown' && <p role="status">启动结果未知，已刷新会话列表。</p>}
          {spawnError && !spawnBusy && <p role="alert" className="pending">{spawnError}</p>}
          {directoryPending && !spawnBusy ? <form className="composer" onSubmit={confirmDirectoryCreation}>
            <p>在 <strong>{directoryPending}</strong> 创建目录并启动会话？</p>
            <button className="primary" type="submit">确认创建</button>
            <button type="button" onClick={resetSpawn}>取消</button>
          </form> : <form className="composer spawn-form" onSubmit={submitSpawn}>
            <select aria-label="设备" value={machineId} onChange={event => setMachineId(event.target.value)}>
              <option value="">选择设备…</option>
              {availableDevices.map(device => <option key={device.id} value={device.id}>{device.title}</option>)}
            </select>
            <select aria-label="Agent" value={agent} onChange={event => setAgent(event.target.value)}>
              <option value="claude">Claude Code</option>
              <option value="codex">Codex</option>
              <option value="dsh">DSH（DeepSeek Harness）</option>
            </select>
            <input aria-label="项目路径" value={directory} onChange={event => setDirectory(event.target.value)} placeholder="/path/to/project" />
            <button className="primary" type="submit" disabled={spawnBusy || !machineId || !directory.trim() || (spawnResult?.kind === 'success')}>启动</button>
          </form>}
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
