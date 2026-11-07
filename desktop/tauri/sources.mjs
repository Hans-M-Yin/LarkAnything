import { execFile } from 'node:child_process';
import { native } from './runtime.mjs';
import { markdownSource, openCodeSource, docxSource } from '../../src/adapters/desktop-sources.mjs';
import { hash } from '../../src/core/model.mjs';
const run=args=>new Promise((resolve,reject)=>execFile('opencode',args,{timeout:30000,maxBuffer:32*1024*1024},(e,out)=>e?reject(new Error('OpenCode 读取失败，请检查设置中的原生可执行文件路径和版本。')):resolve(out)));
export function createSources({transport = native, command = run} = {}){
 const cliVersion = async()=>String(await command(['--version'])).trim();
 let notionToken='';
 const selected=new Map();
 const notion=(action,id,cursor)=>transport('notion',{token:notionToken,action,id,cursor});
 const notionList=async cursor=>{
  const page=await notion('list',null,cursor);
  if(!page||!Array.isArray(page.results)||typeof page.has_more!=='boolean')throw new Error('Notion 返回的列表格式无效。');
  if(page.has_more&&(typeof page.next_cursor!=='string'||!page.next_cursor.trim()))throw new Error('Notion 分页结果不完整。');
  return page;
 };
 return {
  async connectNotion(token) {
   if(typeof token!=='string'||!token.trim())throw new Error('请输入 Notion 集成令牌，并在 Notion 中为页面添加此连接。');
   const old=notionToken;notionToken=token.trim();
   try{await notionList();}catch(e){notionToken=old;throw e;}
   return true;
  },
  async importFile(channel,path){
   if(!['markdown','docx'].includes(channel)||!new RegExp(channel==='docx'?'\\.docx$':'\\.md$','i').test(path))throw new Error('文件类型不匹配。');
   const info=await transport('stat',{path});
   if(info.size>20*1024*1024)throw new Error('请选择不超过 20 MB 的文件。');
   let model;
   if(channel==='markdown')model=markdownSource(channel,hash(path),path.split(/[\\/]/).pop().replace(/\.md$/i,''),await transport('read',{path}));
   else model=docxSource(Uint8Array.from(await transport('read_bytes',{path})),path);
   const item={id:channel+':'+hash(path),title:model.title,excerpt:model.body.slice(0,140),location:path,modified:info.mtimeMs};
   selected.set(item.id,{item,model,size:info.size});return item;
  },
  async list(channel){
   if(['markdown','docx'].includes(channel)){
    const records=[];
    for(const value of [...selected.values()].filter(v=>v.model.source.channel===channel)){
     try{
      const info=await transport('stat',{path:value.item.location});
      records.push(info.size===value.size&&info.mtimeMs===value.item.modified?value.item:await this.importFile(channel,value.item.location));
     }catch(e){records.push({...value.item,error:`无法读取此文件，请确认文件仍存在且可访问。${e?.code?' ('+e.code+')':''}`});}
    }
    return records.sort((a,b)=>b.modified-a.modified);
   }
   if(channel==='opencode'){
    await cliVersion();
    const rows=JSON.parse(await command(['session','list','--format','json']));
    if(!Array.isArray(rows))throw new Error('不支持的 OpenCode 列表格式。');
    return rows.map(r=>({id:'opencode:'+r.id,title:r.title||r.id,location:r.location?.directory||r.directory||'',modified:r.time?.updated||r.updated||0}));
   }
   if(!notionToken)throw new Error('请在设置中连接 Notion，并为所需页面添加该连接。');
   const all=[];const seen=new Set();let cursor;
   do{
    const page=await notionList(cursor);
    for(const p of page.results||[])if(p.object==='page')all.push({id:'notion:'+p.id,title:Object.values(p.properties||{}).find(v=>v.type==='title')?.title?.map(t=>t.plain_text).join('')||'未命名页面',location:p.url,modified:Date.parse(p.last_edited_time)||0});
    cursor=page.has_more?page.next_cursor:null;
    if(cursor&&seen.has(cursor))throw new Error('Notion 分页游标重复，请重新连接后再试。');
    if(cursor)seen.add(cursor);
   }while(cursor);
   return all;
  },
  async load(channel,item){
   if(selected.has(item.id)) {
    // Re-read selected local files at preview time.
    await this.importFile(channel,item.location);return selected.get(item.id).model;
   }
   const id=item.id.slice(channel.length+1);
   if(channel==='opencode'){
    const v=await cliVersion();const args=/^(?:opencode\s+)?v?2\./i.test(v)?['session','export',id]:['export',id];
    return openCodeSource(JSON.parse(await command(args)));
   }
   const page=await notion('read',id);
   if(page.truncated || page.unknown_block_ids?.length)throw new Error('Notion 页面含未完整返回的内容，暂不上传，以免遗漏。');
   return markdownSource('notion',id,item.title,page.markdown,[{code:'NOTION_CONTENT',message:'Notion 图片、附件及特殊块以 Markdown 表示；附件不会自动上传到飞书。'}]);
  }
 };
}
