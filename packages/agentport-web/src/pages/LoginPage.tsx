import type { FormEvent } from 'react';

export function LoginPage({ busy, error, onSubmit }: {
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="auth hero">
    <span className="eyebrow">REMOTE DEVELOPMENT</span>
    <h1>电脑上的开发，<br />在这里继续。</h1>
    <p>连接你的电脑，在浏览器里继续开发会话。</p>
    <form className="panel stack" onSubmit={onSubmit}>
      <div className="actions">
        <button className="primary" disabled={busy}>创建账户 ↗</button>
        <a className="button" href="#restore">恢复账户</a>
      </div>
      {error && <p role="alert" className="pending">{error}</p>}
    </form>
  </section>;
}
