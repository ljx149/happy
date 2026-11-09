import type { FormEvent } from 'react';

export function RestorePage({ busy, error, onSubmit }: {
  busy: boolean;
  error: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <section className="auth hero">
    <a className="back" href="/">返回工作台 ›</a>
    <span className="eyebrow">REMOTE DEVELOPMENT</span>
    <h1>恢复账户</h1>
    <p>输入恢复凭据，继续在浏览器里使用你的账户和加密会话。</p>
    <form className="panel stack" onSubmit={onSubmit}>
      <label>恢复凭据<input name="recovery" required type="password" autoComplete="off" /></label>
      <div className="actions">
        <button className="primary" disabled={busy}>恢复账户</button>
        <a className="button" href="#home">创建新账户</a>
      </div>
      {error && <p role="alert" className="pending">{error}</p>}
    </form>
  </section>;
}
