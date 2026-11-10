import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { io, type Socket } from 'socket.io-client';
import * as api from '../lib/api.ts';
import { errorText, field, sessionSummaries, deviceAgentSupport, type Account, type DeviceAgentSupport } from '../lib/account.ts';
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

type Device = api.RecordSummary & { title: string };

type DeviceState = Device & { decryptable: boolean; support: DeviceAgentSupport };

export function WorkbenchPage({ account }: { account: Account }) {
  const [records, setRecords] = useState<{ sessions: Summary[]; devices: DeviceState[] }>();
  const [error, setError] = useState('');
  const [machineId, setMachineId] = useState('');
  const [agent, setAgent] = useState('claude');
  const [directory, setDirectory] = useState('');
  const [directoryPending, setDirectoryPending] = useState<{ machineId: string; deviceTitle: string; agent: string; directory: string; approvalPath: string } | null>(null);
  const [deviceSupport, setDeviceSupport] = useState<Record<string, DeviceAgentSupport>>({});
  const [spawnBusy, setSpawnBusy] = useState(false);
  const [spawnResult, setSpawnResult] = useState<SpawnInterpretation | null>(null);
  const [spawnError, setSpawnError] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState('');
  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const spawnedRef = useRef(false);
  const refreshRef = useRef<() => void>(() => {});

  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const [sessions, machines] = await Promise.all([api.sessions(account.token), api.machines(account.token)]);
        const sessionList = await sessionSummaries(sessions.sessions, account, '会话');
        const deviceTitles = await sessionSummaries(machines, account, '设备');
        const deviceList = await Promise.all(deviceTitles.map(async machine => {
          const support = machine.dataEncryptionKey
            ? await deviceAgentSupport(machine, account.keys.secretKey)
            : { claude: false, codex: false, dsh: false };
          return { ...machine, title: machine.title, decryptable: !!machine.dataEncryptionKey, support } as DeviceState;
        }));
        if (active) {
          const supportMap: Record<string, DeviceAgentSupport> = {};
          for (const device of deviceList) supportMap[device.id] = device.support;
          setDeviceSupport(supportMap);
          setRecords({ sessions: sessionList, devices: deviceList });
          setError('');
        }
      } catch (error) {
        if (active) setError(errorText(error));
      }
    }
    const socket = io(api.apiBaseUrl(), { path: '/v1/updates', auth: { token: account.token, clientType: 'user-scoped' } });
    socketRef.current = socket;
    refreshRef.current = () => { void refresh(); };
    void refresh();
    socket.on('connect', refresh);
    socket.on('update', update => {
      const type = field(field(update, 'body'), 't');
      if (type !== 'new-message') void refresh();
    });
    return () => { active = false; socket.disconnect(); };
  }, [account]);

  const availableDevices = useMemo(
    () => records?.devices.filter(device => device.active && device.decryptable) ?? [],
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

  async function doSpawn(req: { machineId: string; agent: string; directory: string; approvedNewDirectoryCreation: boolean }) {
    if (!req.machineId || !req.directory.trim()) return;
    const machineKey = machineKeyFor(req.machineId);
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
        buildSpawnParams({ directory: req.directory.trim(), agent: req.agent, approvedNewDirectoryCreation: req.approvedNewDirectoryCreation }),
        machineKey,
      );
      if (!socket.connected) {
        throw new Error('连接已断开，请刷新后重试。');
      }
      let ack: { ok: boolean; result?: string; error?: string };
      try {
        ack = await socket.timeout(30_000).emitWithAck('rpc-call', { method: spawnRpcMethod(req.machineId), params: encrypted });
      } catch {
        // Timeout: result unknown. Never auto-retry; refresh and ask the user to verify.
        spawnedRef.current = false;
        setSpawnResult({ kind: 'unknown', raw: null });
        setSpawnError('启动结果未知，请核对下方会话列表后再决定是否重试。');
        refreshRef.current();
        return;
      }
      if (!ack.ok) {
        spawnedRef.current = false;
        throw new Error(ack.error ?? '启动请求被拒绝。');
      }
      const decoded = await decodeSpawnResult(ack.result ?? '', machineKey);
      const interpretation = interpretSpawnResult(decoded);
      setSpawnResult(interpretation);
      if (interpretation.kind === 'success') {
        location.hash = `#session/${interpretation.sessionId}`;
      } else if (interpretation.kind === 'directory-approval') {
        const deviceTitle = records?.devices.find(d => d.id === req.machineId)?.title ?? req.machineId;
        setDirectoryPending({ machineId: req.machineId, deviceTitle, agent: req.agent, directory: req.directory, approvalPath: interpretation.directory });
      } else if (interpretation.kind === 'error') {
        spawnedRef.current = false;
        setSpawnError(interpretation.message);
      } else {
        spawnedRef.current = false;
        setSpawnError('启动结果未知，请核对下方会话列表后再决定是否重试。');
        refreshRef.current();
      }
    } catch (error) {
      // Explicit failure (connection down, rejection): release the lock so the user can retry.
      spawnedRef.current = false;
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
    void doSpawn({ machineId, agent, directory, approvedNewDirectoryCreation: false });
  }

  function confirmDirectoryCreation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (spawnBusy || !directoryPending) return;
    const req = directoryPending;
    setDirectoryPending(null);
    setSpawnResult(null);
    void doSpawn({ machineId: req.machineId, agent: req.agent, directory: req.approvalPath, approvedNewDirectoryCreation: true });
  }

  function resetSpawn() {
    spawnedRef.current = false;
    setSpawnResult(null);
    setSpawnError('');
    setDirectoryPending(null);
  }

  async function removeDevice(machineId: string) {
    if (removingId) return;
    setRemovingId(machineId);
    setRemoveError('');
    try {
      await api.removeMachine(account.token, machineId);
      setConfirmingRemoveId(null);
      refreshRef.current();
    } catch (error) {
      setRemoveError(errorText(error));
    } finally {
      setRemovingId(null);
    }
  }

  return <div className="layout workspace">
    <aside className="sidebar">
      <a className="back" href="#home">工作台</a>
      <a className="button" href="#pair">＋ 连接电脑</a><h2>最近会话</h2>
      {records && records.sessions.length ? records.sessions.map(session =>
        <a key={session.id} className="row" href={'#session/' + session.id}>
          <span>{session.title}</span>
          {session.dataEncryptionKey === null && <span className="status">旧格式</span>}
        </a>) : <p>暂无会话，请在右侧选择设备并新建会话。</p>}
    </aside>
    <section className="page">
      <div className="hero"><span className="eyebrow">AGENTPORT</span><h1>工作台</h1><p>在浏览器里继续电脑上的开发任务。</p></div>
      {error && <p role="alert" className="pending">{error}</p>}
      {!records && !error && <p role="status">正在同步工作台…</p>}
      {records && <div className="stack">
        <section className="panel"><h2>设备</h2>
          {removeError && <p role="alert" className="pending">{removeError}</p>}
          {records.devices.length ? records.devices.map(device => <div className="row" key={device.id}>
            <span>{device.title}</span>
            <span className={device.active ? 'status online' : 'status'}>{device.active ? '● 在线' : '离线'}</span>
            {!device.decryptable && <span className="status">不可解密</span>}
            {confirmingRemoveId === device.id
              ? <span className="perm-actions">
                <button type="button" className="primary" onClick={() => removeDevice(device.id)} disabled={removingId === device.id}>确认移除</button>
                <button type="button" onClick={() => setConfirmingRemoveId(null)}>取消</button>
              </span>
              : <button type="button" onClick={() => setConfirmingRemoveId(device.id)}>移除设备</button>}
          </div>) : <p>暂无设备。请在电脑上运行 CLI 登录，打开终端给出的配对链接。</p>}
          <p className="hint">「移除设备」只删除服务器上的设备记录和访问密钥，不会中断电脑上正在运行的进程，也不等同于撤销访问凭据。</p>
        </section>
        <section className="panel"><h2>新建会话</h2>
          {spawnBusy && <p role="status">正在启动…</p>}
          {!spawnBusy && spawnResult?.kind === 'success' && <p role="status">已跳转到新会话。</p>}
          {!spawnBusy && spawnResult?.kind === 'unknown' && <p role="status">启动结果未知，请核对下方会话列表后再决定是否重试。</p>}
          {spawnError && !spawnBusy && <p role="alert" className="pending">{spawnError}</p>}
          {machineId && !deviceSupport[machineId]?.[agent as keyof DeviceAgentSupport] && <p role="status">所选设备尚未报告此 Agent 可用。请在该设备安装并登录对应 Agent，再重启 agentport daemon。</p>}
          {directoryPending && !spawnBusy ? <form className="composer" onSubmit={confirmDirectoryCreation}>
            <p>在电脑 <strong>{directoryPending.deviceTitle}</strong> 的 <strong>{directoryPending.approvalPath}</strong> 创建目录并启动 {directoryPending.agent} 会话？</p>
            <button className="primary" type="submit">确认创建</button>
            <button type="button" onClick={resetSpawn}>取消</button>
          </form> : <form className="composer spawn-form" onSubmit={submitSpawn}>
            <select aria-label="设备" value={machineId} onChange={event => setMachineId(event.target.value)}>
              <option value="">选择设备…</option>
              {availableDevices.map(device => <option key={device.id} value={device.id}>{device.title}</option>)}
            </select>
            <select aria-label="Agent" value={agent} onChange={event => setAgent(event.target.value)}>
              <option value="claude" disabled={!deviceSupport[machineId]?.claude}>Claude Code（CC）</option>
              <option value="codex" disabled={!deviceSupport[machineId]?.codex}>Codex</option>
              <option value="dsh" disabled={!deviceSupport[machineId]?.dsh}>DSH（DeepSeek Harness）</option>
            </select>
            {machineId && !deviceSupport[machineId]?.dsh && agent === 'dsh' && (
              <p className="hint">该设备未报告 DSH 支持，请在电脑上安装 <code>dsh</code> 后刷新。</p>
            )}
            <input aria-label="项目路径" value={directory} onChange={event => setDirectory(event.target.value)} placeholder="/path/to/project" />
            <button className="primary" type="submit" disabled={spawnBusy || !machineId || !directory.trim() || !deviceSupport[machineId]?.[agent as keyof DeviceAgentSupport] || (spawnResult?.kind === 'success')}>启动</button>
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
