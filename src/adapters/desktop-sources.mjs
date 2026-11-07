import { conversation, hash, timestamp } from '../core/model.mjs';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export function markdownSource(channel, id, title, body, warnings = []) {
  if (!body?.trim()) throw new Error('文档没有可导出的正文。');
  return {version:1,kind:'markdown-file',id,title,body,source:{channel,completeness:warnings.length?'partial':'complete'},warnings};
}
export function openCodeSource(data) {
  if (!data?.info?.id || !Array.isArray(data.messages)) throw new Error('不支持的 OpenCode 导出格式。');
  const warnings=[];
  const messages = data.messages.flatMap(message => {
    // V1 stores {info, parts}; V2 uses tagged messages with text/content fields.
    let {info,parts}=message;
    if(!info){
      info={id:message.id,role:message.type,time:message.time};
      if(message.type==='user')parts=[{type:'text',text:message.text},...(message.files||[]).map(f=>({type:'file',filename:f.name}))];
      else if(message.type==='assistant')parts=(message.content||[]).map(p=>p.type==='tool'?{...p,tool:p.name}:p);
      else if(message.type==='shell'){
        info.role='tool';parts=[{type:'tool',tool:'shell',state:{command:message.command,output:message.output,exit:message.exit}}];
      }
    }
    if (!['user','assistant','tool'].includes(info?.role)) {
      if(!['system','synthetic','skill','compaction','idle','agent-switched','model-switched','location-switched'].includes(info?.role))warnings.push({code:'OPENCODE_MESSAGE',message:`未导出未知 OpenCode 消息类型：${info?.role||'unknown'}。`});
      return [];
    }
    const content = (parts || []).flatMap(p => p.type === 'text' && !p.synthetic ? [{type:'text',format:'markdown',text:p.text || ''}]
      : p.type === 'tool' ? [{type:'tool',text:JSON.stringify({tool:p.tool,state:p.state})}]
      : p.type === 'file' ? [{type:'unsupported',label:p.filename || '附件'}]
      : ['reasoning','text','step-start','step-finish','snapshot','patch'].includes(p.type) ? []
      : [{type:'unsupported',label:`OpenCode 内容类型：${p.type || 'unknown'}`}]);
    const created=info.time?.created;
    return content.length ? [{id:info.id,role:info.role,timestamp:timestamp(typeof created==='number'?created/1000:created),content}] : [];
  });
  if(messages.some(m=>m.content.some(p=>p.type==='unsupported')))warnings.push({code:'OPENCODE_CONTENT',message:'部分 OpenCode 附件或未知内容仅保留占位说明。'});
  if(data.info.parentID)warnings.push({code:'OPENCODE_FORK',message:'当前为分支会话，仅包含本次导出返回的内容。'});
  return conversation({channel:'opencode',id:data.info.id,title:data.info.title,messages,warnings,completeness:warnings.length?'partial':'complete'});
}
export function docxSource(bytes, path) {
  if (bytes.length > 20*1024*1024) throw new Error('Word 文件超过 20 MB。');
  let expanded=0;
  const entries = unzipSync(bytes,{filter:file => {
    if (!['word/document.xml','word/styles.xml'].includes(file.name)) return false;
    expanded+=file.originalSize;
    if(expanded>20*1024*1024) throw new Error('Word 正文解压后过大。');
    return true;
  }});
  if(!entries['word/document.xml']) throw new Error('文件不是有效的 DOCX 文档。');
  const parser=new XMLParser({preserveOrder:true,ignoreAttributes:false,processEntities:true,trimValues:false,parseTagValue:false});
  const parse=bytes=>{
    const xml=strFromU8(bytes);
    if(/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持包含外部实体的文档。');
    if(XMLValidator.validate(xml)!==true) throw new Error('Word XML 已损坏，不是有效的文档。');
    return parser.parse(xml);
  };
  const nodes=parse(entries['word/document.xml']);
  if(!nodes.find(n=>n['w:document'])?.['w:document']?.some(n=>n['w:body'])) throw new Error('文件不是有效的 DOCX 文档。');
  const styles=new Map();
  if(entries['word/styles.xml']) for(const node of parse(entries['word/styles.xml']).find(n=>n['w:styles'])?.['w:styles']||[]) {
    if(node['w:style']) styles.set(node[':@']?.['@_w:styleId'],node['w:style']);
  }
  const val=(nodes,key)=>nodes?.find(n=>n[key])?.[':@']?.['@_w:val'];
  const headingName=value=>Number(/^(?:Heading|标题)\s*([1-6])$/i.exec(value||'')?.[1])||0;
  const outline=props=>{const value=val(props,'w:outlineLvl');return value===undefined?undefined:(/^[0-5]$/.test(value)?Number(value)+1:0);};
  const headingStyle=(id,seen=new Set())=>{
    if(!id||seen.has(id))return 0;
    seen.add(id);const style=styles.get(id);
    return outline(style?.find(n=>n['w:pPr'])?.['w:pPr']) ?? (headingName(val(style,'w:name'))||headingName(id)||headingStyle(val(style,'w:basedOn'),seen));
  };
  const escape=s=>String(s).replace(/([\\\`*_{}\[\]<>#|])/g,'\\$1');
  const text=ns=>(ns||[]).map(n => n['#text']!==undefined ? escape(n['#text']) : n['w:tab'] ? '  ' : n['w:br'] ? '\n' : n['w:p'] ? text(n['w:p'])+'\n' : Object.entries(n).filter(([k])=>k!==':@' && k!=='w:del' && !k.endsWith('Pr')).map(([,v])=>Array.isArray(v)?text(v):'').join('')).join('');
  const blocks=ns=>(ns||[]).flatMap(n=>{
    if(n['w:p']) {
      const p=n['w:p']; const props=p.find(x=>x['w:pPr'])?.['w:pPr'];
      const heading=outline(props)??headingStyle(val(props,'w:pStyle'));
      return [(heading?'#'.repeat(heading)+' ':props?.some(x=>x['w:numPr'])?'- ':'')+text(p)];
    }
    if(n['w:tbl']) {
      const rows=n['w:tbl'].filter(x=>x['w:tr']).map(r=>r['w:tr'].filter(c=>c['w:tc']).map(c=>text(c['w:tc']).trim().replace(/\n/g,' ')));
      const width=Math.max(0,...rows.map(r=>r.length));
      if(!width)return [];
      const line=r=>'| '+Array.from({length:width},(_,i)=>r[i]||'').join(' | ')+' |';
      return [line(rows[0])+'\n'+line(Array(width).fill('---'))+'\n'+rows.slice(1).map(line).join('\n')];
    }
    return Object.entries(n).filter(([k])=>k!==':@').flatMap(([,v])=>Array.isArray(v)?blocks(v):[]);
  });
  return markdownSource('docx',hash(path),path.split(/[\\/]/).pop().replace(/\.docx$/i,''),blocks(nodes).join('\n\n'),[{code:'DOCX_LAYOUT',message:'已提取正文、标题和表格；超链接仅保留文字，链接目标、图片、批注、修订语义、页眉页脚及复杂排版未保留。'}]);
}
export const snapshotAdapters=['markdown','docx','notion','opencode'].map(id=>({id,version:1,async load({sourceOptions}) {
  const value=sourceOptions?.snapshot;
  if(value?.source?.channel!==id) throw new Error('来源快照无效，请重新选择。');
  return value;
}}));
