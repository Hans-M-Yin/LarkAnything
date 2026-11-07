import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowUpRight, ArrowUpToLine, Check, ChevronRight, FileText, Folder, Inbox, MessageSquare, Moon, RefreshCw, Search, Settings2, ShieldCheck, Sun, X } from 'lucide-react';
import './style.css';
import { SourceSwitcher } from './SourceSwitcher';
import { ConnectionSetup, type SetupAPI } from './ConnectionSetup';
import { useShortcuts, shortcutLabel, shortcutAria } from './useShortcuts';

type Settings = { parentToken: string; includeTools: boolean; executable: string; vault?: string; codexHome?: string; claudeHome?: string; opencodeExecutable?: string };
type Item = { id: string; title: string; excerpt?: string; location?: string; modified: number; count?: number; error?: string };
type Preview = { token: string; title: string; html: string; operation: string; target: string; warnings?: {message:string}[] };
declare global { interface Window { larkAnything: SetupAPI & { setExpanded(value: boolean): Promise<void>; settings(): Promise<Settings>; checkConnection(): Promise<{ ok: boolean; message: string }>; beginConnection(): Promise<{ connected?: boolean; message?: string; url?: string }>; finishConnection(): Promise<{ ok: boolean; message: string }>; openAuthorization(): Promise<void>; saveSettings(v: Settings): Promise<Settings>; list(c: string): Promise<Item[]>; preview(id: string): Promise<Preview>; publish(t: string): Promise<{ remote?: { url?: string }; reused?: boolean }>; chooseDocument(kind: string): Promise<string | null>; importFile(kind: string, path: string): Promise<Item>; connectNotion(token: string): Promise<boolean>; notionConnection(): Promise<{saved:boolean}>; disconnectNotion(): Promise<void>; chooseDirectory(): Promise<string | null>; chooseExecutable(): Promise<string | null>; openResult(u: string): Promise<void> } } }
const api = window.larkAnything;
const previewFonts = new URL('./assets/fonts/fonts.css', location.href).href;
function excerpt(text = '', title = '') {
  const plain = text.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(^|\s)[#>*]+\s*/g, '$1').replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim();
  return plain.startsWith(title) ? plain.slice(title.length).trim() : plain;
}
function relativeDate(value: number) {
  if (!value) return '时间未知';
  const now = new Date(), date = new Date(value);
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now)-day(date))/86400000);
  if(days===0) return '今天 '+date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  if(days===1) return '昨天';
  return date.toLocaleDateString('zh-CN',{month:'short',day:'numeric'});
}
function previewDocument(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const title = doc.querySelector('header h1');
  const heading = doc.querySelector('article > h1, article > h2, article > h3, article > h4, article > h5, article > h6');
  if (title && heading && title.textContent?.trim() === heading.textContent?.trim()) {
    title.closest('header')?.remove();
    const mainTitle=doc.createElement('h1');mainTitle.textContent=heading.textContent;heading.replaceWith(mainTitle);
  }
  doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.setAttribute('content', "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'");
  const link = doc.createElement('link'); link.rel='stylesheet';link.href=previewFonts;doc.head.append(link);
  return '<!doctype html>'+doc.documentElement.outerHTML;
}
const sources = [{ id: 'codex', label: 'Codex', icon: 'codex.svg' }, { id: 'claude-code', label: 'Claude Code', icon: 'claudecode-color.svg' }, { id: 'obsidian', label: 'Obsidian', icon: 'obsidian-color.svg' }, {id:'opencode',label:'OpenCode',icon:'opencode.svg'}, {id:'notion',label:'Notion',icon:'notion.svg'}, {id:'markdown',label:'Markdown',icon:'markdown.svg'}, {id:'docx',label:'Word',icon:'word.svg'}];

function App() {
  const [expanded, setExpanded] = useState(false);
  async function togglePreview(value: boolean) { try { await api.setExpanded(value); setExpanded(value); } catch (e) { fail(e); } }
  const [channel, setChannel] = useState('codex'), [items, setItems] = useState<Item[]>([]), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''), [preview, setPreview] = useState<Preview | null>(null), [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false), [loading, setLoading] = useState(false), [preparing, setPreparing] = useState(false), [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(''), [result, setResult] = useState(''), [completed, setCompleted] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('la-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  const [draft, setDraft] = useState<Settings | null>(null), [saving, setSaving] = useState(false), [settingsError, setSettingsError] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), sequence = useRef(0), selection = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null), previewFrame = useRef<HTMLIFrameElement>(null);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const [notionToken,setNotionToken]=useState(''), [notionStatus,setNotionStatus]=useState('');
  const [notionSaved,setNotionSaved]=useState(false);
  const busy = publishing || preparing;
  const fileSource=['markdown','docx'].includes(channel);
  async function chooseFile(){try{const path=await api.chooseDocument(channel);if(path){await api.importFile(channel,path);await refresh();}}catch(e){fail(e);}}
  const source = sources.find(s => s.id === channel)!;
  const openSettings = () => { if (settings) { setDraft({ ...settings }); setSettingsError(''); setEditing(true); } };
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('la-theme', theme); }, [theme]);
  useEffect(() => { if (editing) dialog.current?.showModal(); else { dialog.current?.close(); setNotionToken(''); } }, [editing]);
  useEffect(() => {
    if (!editing) return;
    let active=true;
    api.notionConnection().then(value=>{if(active){setNotionSaved(value.saved);setNotionStatus(value.saved?'已保存令牌，重启后自动使用；可刷新列表检查连接。':'尚未连接 Notion。');}}).catch(e=>{if(active)setNotionStatus(String(e.message||e));});
    return ()=>{active=false;};
  }, [editing]);
  async function refresh() {
    const version = ++sequence.current; ++selection.current;
    setPreparing(false); setLoading(true); setItems([]); setPreview(null); setSelected(''); setError(''); setCompleted(false);
    try { const list = await api.list(channel); if (version === sequence.current) setItems(list); }
    catch (e) { if (version === sequence.current) fail(e); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { api.settings().then(setSettings).catch(fail); if (!localStorage.getItem('la-setup-dismissed')) api.setupStatus().then(s => { if (s.stage !== 'ready') setOnboarding(true); }).catch(fail); }, []);
  useEffect(() => { refresh(); }, [channel]);
  async function select(item: Item) {
    const version = ++selection.current;
    setSelected(item.id); setPreview(null); setPreparing(true); setError(''); setCompleted(false); setResult('');
    try { const value = await api.preview(item.id); if (version === selection.current) setPreview(value); }
    catch (e) { if (version === selection.current) fail(e); }
    finally { if (version === selection.current) setPreparing(false); }
  }
  async function publish() {
    if (!preview) return; setPublishing(true); setError('');
    try { const value = await api.publish(preview.token); setCompleted(true); setResult(value.remote?.url || ''); }
    catch (e) { fail(e); } finally { setPublishing(false); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!draft || saving) return; setSaving(true); setSettingsError('');
    try { setSettings(await api.saveSettings(draft)); setEditing(false); await refresh(); }
    catch (e) { setSettingsError(e instanceof Error ? e.message : String(e)); } finally { setSaving(false); }
  }
  const visible = items.filter(i => `${i.title} ${i.excerpt || ''} ${i.location || ''}`.toLowerCase().includes(query.toLowerCase()));
  useShortcuts({ search: searchInput, frame: previewFrame, blocked: editing || onboarding || saving, busy, loading,
    canPreview: expanded || !!preview, refresh: () => { void refresh(); },
    selectSource: index => { setChannel(sources[index].id); setQuery(''); },
    preview: () => { void togglePreview(!expanded); }, settings: openSettings });
  const previewHTML = preview ? previewDocument(preview.html).replace('</style>', `html,body{background:${theme === 'dark' ? '#202020' : '#fff'}!important;color:${theme === 'dark' ? '#eee' : '#292929'}!important;color-scheme:${theme}}body{margin:0 auto!important;padding:24px 32px!important;font-family:"Inter","Lark UI CJK","PingFang SC","Microsoft YaHei UI",sans-serif!important;font-size:14px!important;line-height:1.9!important}body:has(article>h1:first-child) header{display:none}code{font-family:Consolas,"SFMono-Regular",monospace!important}h2{border-left-color:#888!important}header small{display:none}header h1{font-size:21px!important}article{border:0!important;padding:0!important;background:transparent!important}h1,h2,h3,h4{color:inherit!important}pre,code,blockquote,th,article>h2{background:${theme === 'dark' ? '#2a2a2a' : '#f6f6f6'}!important;color:inherit!important}td,th,pre,blockquote{border-color:${theme === 'dark' ? '#444' : '#e6e6e6'}!important}</style>`) : undefined;

  return <div className={`app compact ${expanded ? 'expanded' : ''}`}>
    <div className="titlebar" onMouseDown={e => { if (e.button === 0 && e.target === e.currentTarget) (api as any).windowAction?.('drag'); }} onDoubleClick={e => { if (e.target === e.currentTarget) (api as any).windowAction?.('maximize'); }}><img className="app-mark" src="./assets/larkanything.png" alt=""/><span className="app-name">LarkAnything</span>
      {(api as any).windowAction && <div className="window-controls"><button aria-label="最小化窗口" onClick={() => (api as any).windowAction('minimize')}>−</button><button aria-label="最大化或还原窗口" onClick={() => (api as any).windowAction('maximize')}>□</button><button aria-label="关闭窗口" onClick={() => (api as any).windowAction('close')}><X size={14}/></button></div>}
    </div>
    <div className="compact-top"><span className="compact-caption">把想法带到飞书</span><div><button className="icon-button" onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} aria-label={theme === 'light' ? '切换深色模式' : '切换浅色模式'}>{theme === 'light' ? <Moon size={15}/> : <Sun size={15}/>}</button><button className="icon-button" disabled={busy || !settings} onClick={openSettings} aria-label="设置" title={`设置（${shortcutLabel(",")}）`} aria-keyshortcuts={shortcutAria(",")}><Settings2 size={16}/></button></div></div>
    <SourceSwitcher sources={sources} selected={channel} disabled={busy} onSelect={id => { setChannel(id); setQuery(''); }}/>
    <main>
      <div className="workspace">
        <section className="library" aria-label="内容列表">
          <div className="section-title"><h2>{fileSource ? (channel === 'docx' ? 'Word 文档' : 'Markdown 文件') : '最近内容'}</h2>{fileSource && <button className="text-button" disabled={busy || loading} onClick={chooseFile}>选择文件</button>}<button className="icon-button" disabled={loading || busy} onClick={refresh} aria-label="刷新列表" title={`刷新列表（${shortcutLabel("R")}）`} aria-keyshortcuts={shortcutAria("R")}><RefreshCw size={16} className={loading ? 'spin' : ''}/></button></div>
          <label className="search"><Search size={15}/><input ref={searchInput} title={`搜索（${shortcutLabel("F")}）`} aria-keyshortcuts={shortcutAria("F")} aria-label="搜索内容" placeholder="搜索标题、摘录或路径" value={query} onChange={e => setQuery(e.target.value)}/></label>
          <div className="list-caption"><span role="status">{loading ? '正在读取…' : `${visible.length} 项内容`}</span><span>最近修改</span></div>
          <div className="items" aria-busy={loading}>
            {loading ? <div className="skeletons" aria-label="正在读取本地内容">{[0, 1, 2, 3].map(n => <div className="skeleton" key={n}><i/><i/><i/></div>)}</div> : visible.length ? visible.map((item, index) => <button style={{ animationDelay: `${Math.min(index, 5) * 25}ms` }} className={`item ${selected === item.id ? 'selected' : ''}`} key={item.id} disabled={!!item.error || busy} onClick={() => select(item)}>
              <div className="item-top">{['obsidian','markdown','docx','notion'].includes(channel) ? <FileText size={15}/> : <MessageSquare size={15}/>}<time title={item.modified ? new Date(item.modified).toLocaleString('zh-CN') : undefined}>{relativeDate(item.modified)}</time></div>
              <h3>{item.title}</h3><p>{item.error || excerpt(item.excerpt, item.title) || '选择以预览完整内容'}</p><small title={item.location}>{item.location?.split(/[\\/]/).slice(-2).join(' / ')}{item.count !== undefined ? ` · ${item.count} 条消息` : ''}</small>
            </button>) : <div className="empty"><Inbox size={28} strokeWidth={1.3}/><h3>{query ? '没有匹配的内容' : '这里还没有内容'}</h3><p>{query ? '试试其他关键词。' : fileSource ? '选择一个文件，预览后上传。' : channel === 'notion' ? '连接 Notion 后显示授权页面。' : '配置来源，开始整理。'}</p>{!query && <button className="text-button" onClick={fileSource ? chooseFile : openSettings} disabled={!settings}>{fileSource ? '选择文件' : '配置来源'} <ArrowUpRight size={13}/></button>}</div>}
          </div>
          <div className="list-note">{channel === 'notion' ? '仅读取你授权给集成的页面' : fileSource ? '仅导入你选择的文件' : '读取已保存的内容'}</div>
        </section>
        {expanded && <section className="detail" aria-label="内容预览" aria-busy={preparing || publishing}>
          {preparing ? <div className="empty"><div className="spinner"/><h3>正在生成预览</h3><p>准备此次上传的内容快照</p></div> : preview ? <React.Fragment key={preview.token}>
            <div className="preview-title"><span>文档预览</span><button className="icon-button" onClick={() => togglePreview(false)} aria-label="收起预览"><X size={16}/></button><span className="operation">{preview.operation === 'append' ? '追加新增消息' : preview.operation === 'unchanged' ? '内容没有变化' : '创建文档'}</span></div>
            <iframe ref={previewFrame} title="文档预览" sandbox="allow-same-origin" srcDoc={previewHTML}/>
          </React.Fragment> : <div className="welcome" key={channel}><div className="welcome-mark brand-welcome"><img src="./assets/larkanything.png" alt="LarkAnything"/></div><h2>把值得留下的，带到飞书。</h2><p>从左侧选择{['obsidian','markdown','docx','notion'].includes(channel) ? '一篇文档' : '一段会话'}，<br/>预览、整理，让想法有个归处。</p><div className="steps"><span><b>1</b>选择</span><ChevronRight size={12}/><span><b>2</b>预览</span><ChevronRight size={12}/><span><b>3</b>上传</span></div></div>}
        </section>}
      </div>
      {preview?.warnings?.length ? <p className="hint" role="status">{preview.warnings.map(w=>w.message).join(' ')}</p> : null}
      {error && <div className="error" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={15}/></button></div>}

      <footer className="compact-footer"><button className="save-location" disabled={busy || !settings} onClick={openSettings} aria-label="修改保存位置"><Folder size={13}/><strong title={preview?.target || settings?.parentToken}>{preview?.target && preview.target !== '默认位置' ? preview.target : settings?.parentToken || '我的云盘'}</strong><ChevronRight size={12}/></button><div className="upload-actions"><button className="secondary" disabled={!expanded && (!preview || busy)} onClick={() => togglePreview(!expanded)} title={`展开或收起预览（${shortcutLabel("P")}）`} aria-keyshortcuts={shortcutAria("P")}>{expanded ? '收起预览' : '预览'}</button><button className="primary" disabled={!preview || busy || completed} onClick={publish}>{preparing ? '正在准备…' : publishing ? '上传并校验中…' : completed ? <><Check size={14}/>已完成</> : <>上传到飞书<ArrowUpRight size={14}/></>}</button></div></footer>
      {completed && <div className="success" role="status">已通过回读校验{result && <button className="text-button" onClick={() => api.openResult(result).catch(fail)}>打开文档<ArrowUpRight size={13}/></button>}</div>}
    </main>
    {onboarding && <ConnectionSetup api={api} onClose={() => { setOnboarding(false); api.settings().then(setSettings).catch(fail); }}/>}
    <dialog ref={dialog} className="modal" aria-labelledby="settings-title" onCancel={e => { e.preventDefault(); if (!saving) setEditing(false); }}>
      {draft && <><div className="section-title"><h2 id="settings-title">设置</h2><button className="icon-button" disabled={saving} onClick={() => setEditing(false)} aria-label="关闭设置"><X size={18}/></button></div><p className="modal-description">连接本地内容，设置默认保存位置。</p>
      <form onSubmit={save}><fieldset disabled={saving}>
        <button type="button" className="secondary" onClick={() => { setEditing(false); setOnboarding(true); }}>配置飞书连接</button>
        <p className="hint">飞书连接配置和登录凭据会保留，重启后自动使用；保存位置修改后请点击“保存设置”。</p>
        <label>飞书保存位置<input autoFocus value={draft.parentToken} placeholder="文件夹 / 知识库链接，留空使用默认位置" onChange={e => setDraft({ ...draft, parentToken: e.target.value })}/></label>
        <details className="settings-group"><summary>Notion 连接</summary>
        <label>集成令牌<input type="password" autoComplete="off" value={notionToken} onChange={e=>setNotionToken(e.target.value)} placeholder="输入 Notion Integration Token"/></label>
        <p className="hint">在 Notion 页面菜单中为页面添加此连接。连接成功后令牌保存到系统凭据存储，重启自动使用。</p>
        <button type="button" className="secondary" disabled={!notionToken} onClick={async()=>{setSaving(true);try{await api.connectNotion(notionToken);setNotionToken('');setNotionSaved(true);setNotionStatus('连接成功，令牌已安全保存，重启后无需重新输入。');}catch(e){setNotionStatus(e instanceof Error?e.message:String(e));}finally{setSaving(false);}}}>{notionSaved?'更新令牌':'连接 Notion'}</button>
        {notionSaved && <button type="button" className="secondary" onClick={async()=>{setSaving(true);try{await api.disconnectNotion();setNotionSaved(false);setNotionToken('');setNotionStatus('已断开连接并删除保存的令牌。');if(channel==='notion'){setItems([]);setSelected('');setPreview(null);setCompleted(false);}}catch(e){setNotionStatus(e instanceof Error?e.message:String(e));}finally{setSaving(false);}}}>断开连接并删除令牌</button>}
        <p role="status" className="hint">{notionStatus}</p>
        </details><details className="settings-group"><summary>内容来源与高级设置</summary>
        {([{ key: 'vault', label: 'Obsidian 仓库', placeholder: '选择你的 Vault 文件夹' }, { key: 'codexHome', label: 'Codex 数据目录', placeholder: '默认 ~/.codex' }, { key: 'claudeHome', label: 'Claude Code 数据目录', placeholder: '默认 ~/.claude' }, { key: 'opencodeExecutable', label: 'OpenCode 可执行文件', placeholder: '留空从 PATH 查找原生 OpenCode 程序' }, { key: 'executable', label: '飞书 CLI 可执行文件', placeholder: '选择已授权的 CLI 可执行文件' }] as const).map(field => <label key={field.key}>{field.label}<div className="path-field"><input placeholder={field.placeholder} value={draft[field.key] || ''} onChange={e => setDraft({ ...draft, [field.key]: e.target.value })}/><button type="button" aria-label={`选择${field.label}`} onClick={async () => { try { const value = await (['executable','opencodeExecutable'].includes(field.key) ? api.chooseExecutable() : api.chooseDirectory()); if (value) setDraft(s => ({ ...s!, [field.key]: value })); } catch (e) { setSettingsError(e instanceof Error ? e.message : String(e)); } }}><Folder size={15}/></button></div></label>)}
        </details><label className="checkbox"><input type="checkbox" checked={draft.includeTools} onChange={e => setDraft({ ...draft, includeTools: e.target.checked })}/>包含工具日志</label>
        <p className="hint">笔记有修改时创建新文档，相同内容复用原结果。</p>
        {settingsError && <p className="form-error" role="alert">{settingsError}</p>}
        <div className="modal-actions"><button type="button" className="secondary" onClick={() => setEditing(false)}>取消</button><button className="primary" type="submit">{saving ? '正在保存…' : '保存设置'}</button></div>
      </fieldset></form></>}
    </dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
