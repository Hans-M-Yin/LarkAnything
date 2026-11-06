import React, { useEffect, useRef, useState } from 'react';
import { Check, ExternalLink, X } from 'lucide-react';

export type SetupStatus = { stage: 'cli' | 'app' | 'login' | 'ready' | 'error'; appId: string; brand: string; bundled: boolean; message: string };
type Progress = { phase: string; message: string; canOpen: boolean };
export type SetupAPI = {
  setupStatus(): Promise<SetupStatus>; useBundledCli(): Promise<SetupStatus>;
  startAppSetup(value: { mode: string; brand: string; appId?: string; secret?: string }): Promise<Progress>;
  appSetupProgress(): Promise<Progress>; cancelAppSetup(): Promise<Progress>; openAppSetup(): Promise<void>;
  beginConnection(): Promise<{ connected?: boolean; message?: string; url?: string }>;
  finishConnection(): Promise<{ ok: boolean; message: string }>; openAuthorization(): Promise<void>;
  checkConnection(): Promise<{ ok: boolean; message: string }>;
};

export function ConnectionSetup({ api, onClose }: { api: SetupAPI; onClose(): void }) {
  const modal = useRef<HTMLDialogElement>(null);
  const [status, setStatus] = useState<SetupStatus | null>(null), [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [mode, setMode] = useState('create'), [brand, setBrand] = useState('feishu'), [appId, setAppId] = useState(''), [secret, setSecret] = useState('');
  const [loginPending, setLoginPending] = useState(false), [verified, setVerified] = useState(false);
  const running = !!progress && ['starting', 'browser', 'saving'].includes(progress.phase);
  const report = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function inspect() {
    const value = await api.setupStatus(); setStatus(value); setAppId(value.appId); setBrand(value.brand);
    if (value.appId) setMode('existing');
    return value;
  }
  useEffect(() => {
    modal.current?.showModal();
    inspect().catch(report);
    api.appSetupProgress().then(p => { if (p.phase !== 'idle') setProgress(p); }).catch(report);
  }, []);
  useEffect(() => {
    if (!running) return;
    let active = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api.appSetupProgress(); if (!active) return;
        setProgress(value);
        if (value.phase === 'complete') await inspect();
        else if (value.phase === 'failed') setError(value.message);
      } catch (e) { if (active) report(e); }
      if (active) timer = setTimeout(poll, 1500);
    };
    timer = setTimeout(poll, 500);
    return () => { active = false; clearTimeout(timer); };
  }, [running]);
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { report(e); } finally { setBusy(false); } }
  const close = () => { localStorage.setItem('la-setup-dismissed', '1'); onClose(); };
  const step = status?.stage === 'cli' ? 0 : status?.stage === 'app' ? 1 : verified ? 3 : 2;
  return <dialog ref={modal} className="modal setup-modal" aria-labelledby="setup-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <div className="setup-brand"><img src="./assets/larkanything.png" alt=""/><span>LarkAnything</span></div>
    <div className="section-title"><h2 id="setup-title">连接飞书</h2><button className="icon-button" aria-label="关闭连接引导" disabled={busy} onClick={close}><X size={18}/></button></div>
    <p className="modal-description">完成一次连接，让想法有个归处。</p>
    <ol className="setup-steps" aria-label="连接步骤">{['连接组件', '飞书应用', '账号授权'].map((label, i) => <li key={label} className={step > i ? 'done' : step === i ? 'current' : ''}><span>{step > i ? <Check size={12}/> : i + 1}</span>{label}</li>)}</ol>
    {!status ? <p role="status">正在检查本机连接…</p> : <>
      <p className="hint" role="status">{message || progress?.message || status.message}</p>
      {status.stage === 'cli' && <div className="auth-actions">{status.bundled && <button className="primary" disabled={busy} onClick={() => act(async () => { setStatus(await api.useBundledCli()); })}>使用内置连接组件</button>}<button className="secondary" disabled={busy} onClick={() => act(async () => { await inspect(); })}>重新检测</button></div>}
      {status.stage === 'app' && !running && <form onSubmit={e => { e.preventDefault(); act(async () => {
        const request = { mode, brand, appId, secret }; setSecret(''); setMessage('');
        setProgress(await api.startAppSetup(request));
      }); }}>
        <fieldset disabled={busy}>
          {!status.appId && <label>配置方式<select value={mode} onChange={e => setMode(e.target.value)}><option value="create">创建飞书应用</option><option value="existing">使用已有应用</option></select></label>}
          <label>服务<select value={brand} disabled={!!status.appId} onChange={e => setBrand(e.target.value)}><option value="feishu">飞书</option><option value="lark">Lark</option></select></label>
          {mode === 'existing' ? <><label>App ID<input value={appId} readOnly={!!status.appId} onChange={e => setAppId(e.target.value)} placeholder="cli_…" autoComplete="off" required/></label><label>App Secret<input type="password" value={secret} onChange={e => setSecret(e.target.value)} autoComplete="new-password" required/></label><p className="hint">在飞书开放平台的“凭证与基础信息”中获取。密钥交给官方 CLI 的系统凭证存储，不写入 LarkAnything 配置或日志。</p></> : <p className="hint">将在浏览器引导你创建供 LarkAnything 使用的飞书应用。你需要有租户允许的应用创建权限。</p>}
          <button className="primary" type="submit">{busy ? '正在配置…' : mode === 'create' ? '开始创建应用' : '保存应用凭证'}</button>
        </fieldset>
      </form>}
      {running && <div className="auth-actions">{progress?.canOpen && <button className="primary" disabled={busy} onClick={() => act(() => api.openAppSetup())}>打开配置页面 <ExternalLink size={13}/></button>}<button className="secondary" disabled={busy || progress?.phase === 'saving'} onClick={() => act(async () => { setProgress(await api.cancelAppSetup()); })}>停止等待</button></div>}
      {(status.stage === 'login' || status.stage === 'ready') && <div className="auth-actions">
        {!loginPending && <button className="primary" disabled={busy} onClick={() => act(async () => {
          const value = await api.beginConnection();
          if (value.connected) { setVerified(true); setMessage(value.message || '连接成功。'); }
          else { setLoginPending(true); setMessage('请在浏览器完成授权，然后返回此窗口确认。'); await api.openAuthorization(); }
        })}>{busy ? '正在连接…' : status.stage === 'ready' ? '验证连接' : '授权飞书账号'}</button>}
        {loginPending && <><button className="secondary" disabled={busy} onClick={() => act(() => api.openAuthorization())}>打开授权页面</button><button className="primary" disabled={busy} onClick={() => act(async () => {
          try { const result = await api.finishConnection(); setMessage(result.message); setVerified(result.ok); await inspect(); }
          finally { setLoginPending(false); }
        })}>{busy ? '正在验证…' : '我已完成授权'}</button></>}
        {!loginPending && <button className="secondary" disabled={busy} onClick={() => act(async () => { const result = await api.checkConnection(); setMessage(result.message); setVerified(result.ok); await inspect(); })}>检查飞书连接</button>}
      </div>}
      {status.stage === 'error' && <button className="secondary" disabled={busy} onClick={() => act(async () => { await inspect(); })}>重新检测</button>}
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button className={verified ? 'primary' : 'secondary'} disabled={busy} onClick={close}>{verified ? '开始使用' : '稍后连接'}</button></div>
  </dialog>;
}
