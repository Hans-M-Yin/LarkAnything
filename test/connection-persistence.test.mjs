import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSources } from '../desktop/tauri/sources.mjs';
import { DesktopService } from '../desktop/service.mjs';

test('Notion reconnects with native stored credential after worker restart; failed replacements preserve it', async () => {
  let saved, storageFails=false, offline=false; const requests=[];
  const transport=async(op,args)=>{
    if(op==='notion_credential'){
      if(args.action==='status') return {saved:!!saved};
      if(storageFails) throw new Error('ECREDENTIAL');
      if(args.action==='save') saved=args.token;
      else if(args.action==='delete') saved=undefined;
      return;
    }
    requests.push(args);
    if(offline)throw new Error('ENET');
    if(!(args.token||saved))throw new Error('ENOTION_AUTH');
    if(args.token==='bad')throw new Error('401');
    return {results:[],has_more:false};
  };
  const first=createSources({transport});
  await assert.rejects(first.list('notion'),/ENOTION_AUTH/);
  await first.connectNotion(' good ');
  const restarted=createSources({transport});
  assert.deepEqual(await restarted.notionConnection(),{saved:true});
  assert.deepEqual(await restarted.list('notion'),[]);
  assert.ok(!('token' in requests.at(-1)), 'saved token never needs to travel back through the worker');
  await assert.rejects(restarted.connectNotion('bad'),/401/);
  assert.equal(saved,'good');
  storageFails=true;
  await assert.rejects(restarted.connectNotion('replacement'),/ECREDENTIAL/);
  await assert.rejects(restarted.disconnectNotion(),/ECREDENTIAL/);
  assert.equal(saved,'good');
  storageFails=false;offline=true;
  await assert.rejects(restarted.list('notion'),/ENET/);
  assert.deepEqual(await restarted.notionConnection(),{saved:true});
  offline=false;
  await restarted.disconnectNotion();
  const third=createSources({transport});
  assert.deepEqual(await third.notionConnection(),{saved:false});
  await assert.rejects(third.list('notion'),/ENOTION_AUTH/);
});

test('Feishu settings and CLI credential profile survive service restart and unrelated settings saves', async t => {
  const root=await mkdtemp(join(tmpdir(),'la-persistence-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const configDir=join(root,'connections','existing');
  await writeFile(join(root,'config.json'),JSON.stringify({version:1,backends:{'lark-cli':{configDir,identity:'user',executable:'lark-cli'}}}));
  const first=new DesktopService({root});
  await first.saveSettings({parentToken:'https://example.feishu.cn/drive/folder/qa123',executable:'lark-cli',includeTools:true});
  const restarted=new DesktopService({root,authInspector:async(_exe,dir)=>{
    assert.equal(dir,configDir);
    return {appId:'synthetic-app',userAvailable:true};
  }});
  assert.equal((await restarted.settings()).parentToken,'qa123');
  assert.equal((await restarted.settings()).includeTools,true);
  assert.equal((await restarted.setupStatus()).stage,'ready');
  await restarted.saveSettings({...await restarted.settings(),vault:join(root,'vault')});
  const config=JSON.parse(await readFile(join(root,'config.json'),'utf8'));
  assert.equal(config.backends['lark-cli'].configDir,configDir);
  assert.equal(config.backends['lark-cli'].identity,'user');
  assert.equal((await new DesktopService({root}).engine()).backends.get('lark-cli').options.configDir,configDir);
});
