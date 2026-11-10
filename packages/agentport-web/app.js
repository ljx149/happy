const screen = document.querySelector('#screen');
const sidebar = document.querySelector('#sidebar');
const layout = document.querySelector('#layout');
const account = document.querySelector('#account');

const devices = [
  { id: 'mac', name: 'MacBook Pro', platform: 'macOS', online: true, projects: ['~/projects/happy', '~/projects/demo'] },
  { id: 'linux', name: 'Linux Workstation', platform: 'Linux', online: false, projects: ['~/projects/demo'] },
];

const sessions = [{
  id: 'login-fix',
  title: '修复登录状态',
  device: 'mac',
  project: '~/projects/happy',
  agent: 'Codex',
  messages: [
    { author: '你', text: '修复登录状态不同步的问题，然后运行测试。' },
    { author: 'Codex', text: '已检查登录状态的更新路径。接下来需要运行测试。' },
  ],
  approval: { command: 'pnpm test', status: '待审批' },
}];

const terminalRoute = location.pathname === '/terminal/connect';
let signedIn = false;
let paired = false;
let revokeTarget;
let selectedDevice = devices[0].id;
let nextId = 1;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function deviceName(id) {
  return devices.find(device => device.id === id)?.name ?? '已移除的设备';
}

function sessionRows(current) {
  if (!sessions.length) return '<p>暂无会话。创建一个会话开始。</p>';
  return sessions.map(session => {
    const online = devices.some(device => device.id === session.device && device.online);
    const status = online && session.approval?.status === '待审批' ? '<span class="status pending">待审批</span>' : '';
    return `<a class="row" href="#session/${session.id}" ${current === session.id ? 'aria-current="page"' : ''}>
      <span>${escapeHtml(session.title)}<small>${session.agent} · ${deviceName(session.device)}</small></span>${status}
    </a>`;
  }).join('');
}

function deviceRows(manage = false) {
  return devices.map(device => `<div class="row">
    <span>${device.name}<small>${device.platform} · 本地执行</small></span>
    <span class="status ${device.online ? 'online' : ''}">${device.revoked ? '授权已撤销' : device.online ? '● 在线' : '离线'}</span>
    ${manage && !device.revoked ? `<button data-action="review-revoke" data-device="${device.id}" aria-label="撤销 ${device.name} 授权">撤销</button>` : ''}
  </div>`).join('');
}

function heading(title, description, label) {
  return `<span class="eyebrow">${label}</span><h1>${title}</h1><p>${description}</p>`;
}

function homeView() {
  return `<div class="page">
    <div class="hero">${heading('工作台', '在浏览器里继续电脑上的开发任务。', 'WORKSPACE')}
      <div class="actions"><a class="button primary" href="#new">＋ 新建会话</a><a class="button" href="#pair">连接电脑</a></div>
    </div>
    <div class="stack">
      <section class="panel"><div class="section-head"><h2>设备</h2><a class="back" href="#devices">管理设备 ›</a></div>${deviceRows()}</section>
      <section class="panel"><h2>最近会话</h2>${sessionRows()}</section>
    </div>
  </div>`;
}

function devicesView() {
  return `<div class="page">
    <a class="back" href="#home">‹ 工作台</a>
    <div class="hero">${heading('设备管理', '查看已连接电脑、添加设备或撤销授权。', 'DEVICES')}
      <div class="actions"><a class="button primary" href="#pair">＋ 连接电脑</a></div>
    </div>
    <section class="panel" aria-label="已连接设备">${deviceRows(true)}</section>
    <dialog id="revoke-device" class="panel" aria-labelledby="revoke-title">
      <h2 id="revoke-title">撤销设备授权？</h2>
      <p id="revoke-description"></p>
      <form method="dialog" class="actions">
        <button autofocus>取消</button>
        <button type="button" data-action="revoke" class="primary">确认撤销</button>
      </form>
    </dialog>
  </div>`;
}

function pairView() {
  return `<div class="page">
    <a class="back" href="#home">‹ 工作台</a>
    <div class="hero">${heading('连接电脑', '在电脑终端运行以下命令，再在浏览器中确认连接。', 'TERMINAL LINK')}</div>
    <section class="panel stack">
      <code class="readout">agentport auth login</code>
      <p>预览使用虚拟设备。真实终端授权需要接入账户与配对协议。</p>
      <div class="actions">
        ${paired ? '<span class="status online" role="status">● 演示设备已连接</span><a class="button" href="#home">返回工作台</a>' :
          '<a class="button" href="#home">取消</a><button class="primary" data-action="pair">确认演示连接</button>'}
      </div>
    </section>
  </div>`;
}

function newView() {
  if (!devices.some(device => device.online)) {
    return `<div class="page"><a class="back" href="#home">‹ 工作台</a>
      <div class="hero">${heading('新建会话', '暂无在线电脑。连接一台电脑后即可创建会话。', 'NEW SESSION')}
      <div class="actions"><a class="button primary" href="#pair">连接电脑</a></div></div></div>`;
  }
  return `<div class="page">
    <a class="back" href="#home">‹ 工作台</a>
    <div class="hero">${heading('新建会话', '选择运行 Agent 的电脑和项目。', 'NEW SESSION')}</div>
    <form id="new-session" class="panel stack form">
      <label>设备<select name="device">${devices.map(device =>
        `<option value="${device.id}" ${device.online ? '' : 'disabled'} ${device.id === selectedDevice ? 'selected' : ''}>${device.name}${device.online ? '' : ' · 离线'}</option>`
      ).join('')}</select></label>
      <label>项目<select name="project" required></select></label>
      <label>Agent<select name="agent"><option>Codex</option><option>Claude Code</option></select></label>
      <label>第一条消息（可选）<textarea name="prompt" rows="3" maxlength="4000" placeholder="告诉 Agent 你想做什么…"></textarea></label>
      <div class="actions"><button class="primary" type="submit">创建会话 ↗</button><a class="button" href="#home">取消</a></div>
    </form>
  </div>`;
}

function messageView(message) {
  return `<div class="message" data-author="${message.author}"><strong>${message.author}</strong>${escapeHtml(message.text)}</div>`;
}

function approvalView(approval, device) {
  if (!approval) return '';
  const pending = approval.status === '待审批';
  return `<section class="panel stack tool" aria-label="工具审批">
    <h2 class="${pending ? 'pending' : ''}">${approval.status}</h2>
    <p>请求在 ${device} 上运行以下命令</p>
    <code class="readout">${escapeHtml(approval.command)}</code>
    ${pending ? '<div class="actions"><button data-action="deny">拒绝</button><button class="primary" data-action="approve">允许一次</button></div>' : ''}
  </section>`;
}

function chatView(session) {
  const device = deviceName(session.device);
  const connected = devices.some(item => item.id === session.device && item.online);
  return `<div class="page chat">
    <div class="chat-head">
      <a class="back mobile-only" href="#home">‹ 会话列表</a>
      <span class="eyebrow">SESSION</span>
      <h1>${escapeHtml(session.title)}</h1>
      <p>${session.agent} · ${device} · <code>${escapeHtml(session.project)}</code></p>
    </div>
    <section id="thread" class="thread" aria-label="会话消息">
      ${session.messages.map(messageView).join('')}
      ${connected ? approvalView(session.approval, device) : '<p role="status">设备当前不可用。你仍可查看历史消息。</p>'}
      ${session.messages.length ? '' : '<p id="empty-chat">发送第一条消息，开始会话。</p>'}
    </section>
    <form id="composer" class="composer">
      <textarea name="message" aria-label="消息" rows="1" maxlength="4000" required ${connected ? 'placeholder="发送指令…"' : 'disabled placeholder="设备不可用"'}></textarea>
      <button class="primary" type="submit" ${connected ? '' : 'disabled'}>发送 ↑</button>
    </form>
  </div>`;
}

function activeSession(route) {
  return sessions.find(session => route === 'session/' + session.id);
}

function routeName() {
  return location.hash.slice(1) || (terminalRoute ? 'pair' : 'home');
}

function render() {
  const requested = routeName();
  const route = signedIn
    ? requested === 'login' || requested === 'restore' ? 'home' : requested
    : requested === 'restore' ? 'restore' : 'login';
  const session = activeSession(route);

  sidebar.hidden = !signedIn;
  account.hidden = !signedIn;
  layout.classList.toggle('workspace', signedIn);

  if (!signedIn) {
    const template = document.querySelector('#' + route + '-template');
    screen.replaceChildren(template.content.cloneNode(true));
    return;
  }

  sidebar.innerHTML = `<nav aria-label="工作台导航">
    <a class="button primary" href="#new">＋ 新建会话</a>
    <div class="nav"><a href="#home" ${route === 'home' ? 'aria-current="page"' : ''}>工作台</a>
    <a href="#devices" ${route === 'devices' ? 'aria-current="page"' : ''}>设备</a></div>
    <h2 class="label">最近会话</h2>${sessionRows(session?.id)}
  </nav>`;

  if (session) screen.innerHTML = chatView(session);
  else if (route === 'new') {
    if (!devices.some(device => device.id === selectedDevice && device.online)) {
      selectedDevice = devices.find(device => device.online)?.id;
    }
    screen.innerHTML = newView();
    if (selectedDevice) refreshProjects();
  } else if (route === 'devices') screen.innerHTML = devicesView();
  else if (route === 'pair') screen.innerHTML = pairView();
  else screen.innerHTML = homeView();
}

function refreshProjects() {
  const device = devices.find(item => item.id === selectedDevice);
  const picker = screen.querySelector('select[name="project"]');
  picker.replaceChildren(...device.projects.map(project => new Option(project, project)));
}

function navigate(route) {
  const hash = '#' + route;
  if (location.hash === hash) render();
  else location.hash = hash;
}

window.addEventListener('hashchange', () => {
  render();
  screen.focus();
});

account.textContent = '退出';
account.addEventListener('click', () => {
  signedIn = false;
  navigate('login');
});

screen.addEventListener('change', event => {
  if (event.target.name !== 'device') return;
  selectedDevice = event.target.value;
  refreshProjects();
});

screen.addEventListener('click', event => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'enter') {
    signedIn = true;
    navigate(terminalRoute ? 'pair' : 'home');
  } else if (action === 'pair') {
    paired = true;
    const device = devices.find(item => item.revoked) ?? devices[1];
    device.online = true;
    device.revoked = false;
    render();
    screen.focus();
  } else if (action === 'review-revoke') {
    revokeTarget = devices.find(device => device.id === event.target.closest('button').dataset.device);
    screen.querySelector('#revoke-description').textContent =
      revokeTarget.name + ' 将无法接收新任务，已有会话仍可查看。';
    screen.querySelector('#revoke-device').showModal();
  } else if (action === 'revoke' && revokeTarget) {
    revokeTarget.online = false;
    revokeTarget.revoked = true;
    paired = false;
    revokeTarget = undefined;
    render();
    screen.focus();
  } else if (action === 'approve' || action === 'deny') {
    const session = activeSession(routeName());
    if (session?.approval?.status !== '待审批') return;
    session.approval.status = action === 'approve' ? '已批准一次（演示）' : '已拒绝（演示）';
    render();
    const heading = screen.querySelector('.tool h2');
    heading.tabIndex = -1;
    heading.focus();
  }
});

screen.addEventListener('submit', event => {
  const form = event.target;
  if (form.method === 'dialog') return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'new-session') {
    const device = devices.find(item => item.id === data.get('device'));
    const project = data.get('project');
    const agent = data.get('agent');
    if (!device?.online || !device.projects.includes(project) || !['Codex', 'Claude Code'].includes(agent)) return;
    const prompt = data.get('prompt').trim();
    const session = {
      id: 'demo-' + nextId++,
      title: prompt ? Array.from(prompt).slice(0, 28).join('') : '新会话',
      device: device.id,
      project,
      agent,
      messages: prompt ? [{ author: '你', text: prompt }] : [],
    };
    sessions.unshift(session);
    navigate('session/' + session.id);
  } else if (form.id === 'composer') {
    const session = activeSession(routeName());
    const text = data.get('message').trim();
    if (!session || !text || !devices.some(device => device.id === session.device && device.online)) return;
    const message = { author: '你', text };
    session.messages.push(message);
    screen.querySelector('#empty-chat')?.remove();
    screen.querySelector('#thread').insertAdjacentHTML('beforeend', messageView(message));
    form.reset();
    form.elements.message.focus();
  }
});

render();
