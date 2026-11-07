import { conversation, hash, timestamp } from '../core/model.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

export function markdownSource(channel, id, title, body, warnings = []) {
  if (!body?.trim()) throw new Error('文档没有可导出的正文。');
  return {version:1,kind:'markdown-file',id,title,body,source:{channel,completeness:warnings.length?'partial':'complete'},warnings};
}
export function openCodeSource(data) {
  if (!data?.info?.id || !Array.isArray(data.messages)) throw new Error('不支持的 OpenCode 导出格式。');
  const messages = data.messages.flatMap(({info,parts}) => {
    if (!['user','assistant'].includes(info?.role)) return [];
    const content = (parts || []).flatMap(p => p.type === 'text' && !p.synthetic ? [{type:'text',format:'markdown',text:p.text || ''}]
      : p.type === 'tool' ? [{type:'tool',text:JSON.stringify({tool:p.tool,state:p.state})}]
      : p.type === 'file' ? [{type:'unsupported',label:p.filename || '附件'}] : []);
    return content.length ? [{id:info.id,role:info.role,timestamp:timestamp(info.time?.created),content}] : [];
  });
  return conversation({channel:'opencode',id:data.info.id,title:data.info.title,messages});
}
export function docxSource(bytes, path) {
  if (bytes.length > 20*1024*1024) throw new Error('Word 文件超过 20 MB。');
  let expanded=0;
  const entries = unzipSync(bytes,{filter:file => {
    if (!['word/document.xml'].includes(file.name)) return false;
    expanded+=file.originalSize;
    if(expanded>20*1024*1024) throw new Error('Word 正文解压后过大。');
    return true;
  }});
  if(!entries['word/document.xml']) throw new Error('文件不是有效的 DOCX 文档。');
  const xml=strFromU8(entries['word/document.xml']);
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含外部实体的文档。');
  const nodes=new XMLParser({preserveOrder:true,ignoreAttributes:false,processEntities:true,trimValues:false,parseTagValue:false}).parse(xml);
  const escape=s=>String(s).replace(/([\\\`*_{}\[\]<>#|])/g,'\\$1');
  const text=ns=>(ns||[]).map(n => n['#text']!==undefined ? escape(n['#text']) : n['w:tab'] ? '  ' : n['w:br'] ? '\n' : Object.entries(n).filter(([k])=>k!==':@' && k!=='w:del' && !k.endsWith('Pr')).map(([,v])=>Array.isArray(v)?text(v):'').join('')).join('');
  const blocks=ns=>(ns||[]).flatMap(n=>{
    if(n['w:p']) {
      const p=n['w:p']; const style=p.find(x=>x['w:pPr'])?.['w:pPr']?.find(x=>x['w:pStyle'])?.[':@']?.['@_w:val'];
      const heading=/^(?:Heading|标题)\s*([1-6])$/i.exec(style||'');
      return [(heading?'#'.repeat(Number(heading[1]))+' ':p.find(x=>x['w:pPr'])?.['w:pPr']?.some(x=>x['w:numPr'])?'- ':'')+text(p)];
    }
    if(n['w:tbl']) {
      const rows=n['w:tbl'].filter(x=>x['w:tr']).map(r=>r['w:tr'].filter(c=>c['w:tc']).map(c=>text(c['w:tc']).replace(/\n/g,' ')));
      const width=Math.max(0,...rows.map(r=>r.length));
      if(!width)return [];
      const line=r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |';
      return [line(rows[0])+'\n'+line(Array(width).fill('---'))+'\n'+rows.slice(1).map(line).join('\n')];
    }
    return Object.entries(n).filter(([k])=>k!==':@').flatMap(([,v])=>Array.isArray(v)?blocks(v):[]);
  });
  return markdownSource('docx',hash(path),path.split(/[\\/]/).pop().replace(/\.docx$/i,''),blocks(nodes).join('\n\n'),[{code:'DOCX_LAYOUT',message:'已提取正文、标题和表格；图片、批注、修订语义、页眉页脚及复杂排版未保留。'}]);
}
export const snapshotAdapters=['markdown','docx','notion','opencode'].map(id=>({id,version:1,async load({sourceOptions}) {
  const value=sourceOptions?.snapshot;
  if(value?.source?.channel!==id) throw new Error('来源快照无效，请重新选择。');
  return value;
}}));
