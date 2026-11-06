import { initialize, reply, native } from './runtime.mjs';
import { createSources } from './sources.mjs';
let service;
const allowed = new Set(['settings', 'saveSettings', 'list', 'preview', 'publish', 'checkConnection', 'beginConnection', 'finishConnection', 'setupStatus', 'useBundledCli', 'startAppSetup']);
onmessage = async ({ data }) => {
  if (data.nativeReply) { reply(data); return; }
  try {
    let value;
    if (data.method === 'initialize') {
      initialize(data.args[0]);
      const { DesktopService } = await import('../service.mjs');
      service = new DesktopService({ root: data.args[0].root, bundledExecutable: data.args[0].bundledExecutable || undefined });
      service.sources = createSources();
    } else if (data.method === 'connectNotion') {
      value = await service.sources.connectNotion(...data.args);
    } else if (data.method === 'importFile') {
      value = await service.sources.importFile(...data.args);
    } else if (!service) throw new Error('Service not ready');
    else if (allowed.has(data.method)) value = await service[data.method](...data.args);
    else if (data.method === 'appSetupProgress') value = service.setupProcess.snapshot();
    else if (data.method === 'cancelAppSetup') value = service.setupProcess.cancel();
    else if (data.method === 'openAppSetup') {
      if (service.setupProcess.phase !== 'browser' || !service.setupProcess.url) throw new Error('配置链接不可用。');
      await native('open_url', { url: service.setupProcess.url });
    } else if (data.method === 'openAuthorization') {
      if (!service.pendingAuth || service.pendingAuth.expiresAt <= Date.now()) throw new Error('授权已过期。');
      await native('open_url', { url: service.pendingAuth.url });
    } else throw new Error('Unsupported method');
    postMessage({ id: data.id, value });
  } catch (e) { postMessage({ id: data.id, error: `${e.code ? e.code + ': ' : ''}${e.message}` }); }
};
