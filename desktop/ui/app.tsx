import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
type Settings = { parentToken: string; includeTools: boolean; executable: string; vault?: string; codexHome?: string; claudeHome?: string };
type Item = { id: string; title: string; excerpt?: string; location?: string; modified: number; count?: number; error?: string };
type Preview = { token: string; title: string; html: string; operation: string; target: string };
declare global { interface Window { larkAnything: { settings(): Promise<Settings>; saveSettings(v: Settings): Promise<Settings>; list(c: string): Promise<Item[]>; preview(id: string): Promise<Preview>; publish(t: string): Promise<{ remote?: { url?: string }; reused?: boolean }>; chooseDirectory(): Promise<string | null>; chooseExecutable(): Promise<string | null>; openResult(u: string): Promise<void> } } }
const api = window.larkAnything;
const sources = [{ id: 'codex', label: 'Codex', symbol: '⌘', color: 'ink' }, { id: 'claude-code', label: 'Claude Code', symbol: '✳', color: 'clay' }, { id: 'obsidian', label: 'Obsidian', symbol: '◇', color: 'violet' }];
function App() {
  const [channel, setChannel] = useState('codex'), [items, setItems] = useState<Item[]>([]), [query, setQuery] = useState('');
  const [selected, setSelected] = useState(''), [preview, setPreview] = useState<Preview | null>(null), [settings, setSettings] = useState<Settings | null>(null);
  const [editing, setEditing] = useState(false), [loading, setLoading] = useState(false), [preparing, setPreparing] = useState(false), [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(''), [result, setResult] = useState(''), [completed, setCompleted] = useState(false);
  const sequence = useRef(0), selection = useRef(0);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  async function refresh() {
    const version = ++sequence.current; ++selection.current; setPreparing(false); setLoading(true); setItems([]); setPreview(null); setSelected(''); setError(''); setCompleted(false);
    try { const list = await api.list(channel); if (version === sequence.current) setItems(list); } catch (e) { if (version === sequence.current) fail(e); }
    finally { if (version === sequence.current) setLoading(false); }
  }
  useEffect(() => { api.settings().then(setSettings).catch(fail); }, []);
  useEffect(() => { refresh(); }, [channel]);
  async function select(item: Item) {
    const version = ++selection.current; setSelected(item.id); setPreview(null); setPreparing(true); setError(''); setCompleted(false); setResult('');
    try { const value = await api.preview(item.id); if (version === selection.current) setPreview(value); } catch (e) { if (version === selection.current) fail(e); }
    finally { if (version === selection.current) setPreparing(false); }
  }
  async function publish() {
    if (!preview) return; setPublishing(true); setError('');
    try { const value = await api.publish(preview.token); setCompleted(true); setResult(value.remote?.url || ''); } catch (e) { fail(e); } finally { setPublishing(false); }
  }
  const visible = items.filter(i => `${i.title} ${i.excerpt || ''} ${i.location || ''}`.toLowerCase().includes(query.toLowerCase()));
  const label = sources.find(s => s.id === channel)!.label;
  return <div className="app"><aside className="rail"><div className="brand" title="LarkAnything">L<span>↗</span></div><div className="sources">{sources.map(s => <button disabled={publishing || preparing} title={s.label} aria-label={s.label} aria-pressed={channel === s.id} className={`source ${s.color} ${channel === s.id ? 'active' : ''}`} key={s.id} onClick={() => { setChannel(s.id); setQuery(''); }}><b>{s.symbol}</b><span>{s.label === 'Claude Code' ? 'Claude' : s.label}</span></button>)}</div><button className="settings-button" disabled={publishing || preparing} onClick={() => setEditing(true)} aria-label="设置">⚙<span>设置</span></button></aside>
  <main><header><div><div className="eyebrow">LARKANYTHING / YOUR KNOWLEDGE, TOGETHER</div><h1>值得留下的，都在这里。</h1><p>从会话到笔记，轻松收藏到飞书。</p></div><span className="local-tag">● 本地读取</span></header>
  <div className="workspace"><section className="library"><div className="section-title"><h2>{label}</h2><button disabled={loading || publishing || preparing} onClick={refresh} aria-label="刷新列表">↻</button></div><label className="search"><span>⌕</span><input placeholder="搜索标题、摘录或路径" value={query} onChange={e => setQuery(e.target.value)} /></label><div className="list-caption">{loading ? '正在读取本地内容…' : `${visible.length} 项内容`}<span>最近修改</span></div><div className="items">{loading ? <div className="empty"><div className="spinner"/><p>正在整理内容列表</p><small>首次读取可能需要一些时间</small></div> : visible.length ? visible.map(item => <button className={`item ${selected === item.id ? 'selected' : ''}`} key={item.id} disabled={!!item.error || publishing || preparing} onClick={() => select(item)}><div className="item-top"><span className="file-icon">{channel === 'obsidian' ? '▤' : '▱'}</span><time>{item.modified ? new Date(item.modified).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无法读取'}</time></div><h3>{item.title}</h3><p>{item.error || item.excerpt}</p><small title={item.location}>{item.location?.split(/[\\/]/).slice(-2).join(' / ')}{item.count !== undefined ? ` · ${item.count} 条消息` : ''}</small></button>) : <div className="empty"><div className="empty-icon">▤</div><h3>{query ? '没有匹配的内容' : '这里还没有内容'}</h3><p>{query ? '试试其他关键词。' : '在设置中选择来源数据目录，然后刷新列表。'}</p><button onClick={() => setEditing(true)}>配置来源 →</button></div>}</div><div className="list-note">时间来自本地文件 · 内容保留在本机，直到你上传</div></section>
  <section className="detail">{preparing ? <div className="empty"><div className="spinner"/><h3>正在生成预览</h3><p>读取内容并准备此次上传的快照</p></div> : preview ? <><div className="preview-title"><span>上传预览</span><span>{preview.operation === 'append' ? '追加新增消息' : preview.operation === 'unchanged' ? '内容没有变化' : '创建文档'}</span></div><iframe title="文档预览" sandbox="" srcDoc={preview.html}/><footer><div><small>保存到飞书</small><strong title={preview.target}>{preview.target === '默认位置' ? '我的云盘 · 默认位置' : preview.target}</strong></div><button className="primary" disabled={publishing || completed} onClick={publish}>{publishing ? '正在上传并校验…' : completed ? '✓ 已完成' : '上传到飞书 ↗'}</button></footer>{completed && <div className="success" role="status">内容已通过回读校验。{result && <button onClick={() => api.openResult(result).catch(fail)}>打开飞书文档 ↗</button>}</div>}</> : <div className="welcome"><div className="orbit">↗</div><div className="eyebrow">A LITTLE SPACE FOR BIG IDEAS</div><h2>让好想法，有个归处。</h2><p>选择左侧的一段会话或一篇笔记，<br/>预览后发送到你的飞书云盘。</p><div className="steps"><span>01 选择</span><i>—</i><span>02 预览</span><i>—</i><span>03 收藏</span></div></div>}</section></div>
  {error && <div className="error" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭错误">×</button></div>}</main>
  {editing && settings && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="设置"><div className="section-title"><h2>设置</h2><button onClick={() => setEditing(false)} aria-label="关闭设置">×</button></div><p>为你的内容，安排一个默认归处。</p><form onSubmit={async e => { e.preventDefault(); try { setSettings(await api.saveSettings(settings)); setEditing(false); refresh(); } catch (e) { fail(e); } }}>
  <label>飞书保存位置<input value={settings.parentToken} placeholder="粘贴文件夹 / 知识库链接，留空使用默认位置" onChange={e => setSettings({ ...settings, parentToken: e.target.value })}/></label>
  {([{ key: 'vault', label: 'Obsidian 仓库' }, { key: 'codexHome', label: 'Codex 数据目录（默认 ~/.codex）' }, { key: 'claudeHome', label: 'Claude 数据目录（默认 ~/.claude）' }, { key: 'executable', label: '飞书 CLI 可执行文件' }] as const).map(field => <label key={field.key}>{field.label}<div className="path-field"><input value={settings[field.key] || ''} onChange={e => setSettings({ ...settings, [field.key]: e.target.value })}/><button type="button" onClick={async () => { try { const value = await (field.key === 'executable' ? api.chooseExecutable() : api.chooseDirectory()); if (value) setSettings(s => ({ ...s!, [field.key]: value })); } catch (e) { fail(e); } }}>选择</button></div></label>)}
  <label className="checkbox"><input type="checkbox" checked={settings.includeTools} onChange={e => setSettings({ ...settings, includeTools: e.target.checked })}/> 导出工具日志</label><p className="hint">测试版复用飞书 CLI 授权。首次连接请先按安装指南完成授权。笔记修改后创建新文档；相同内容重复上传复用原结果。</p><button className="primary" type="submit">保存设置</button></form></section></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
