import { codexAdapter } from './adapters/codex.mjs';
import { claudeCodeAdapter } from './adapters/claude-code.mjs';
import { chatgptAdapter } from './adapters/chatgpt.mjs';
import { genericAdapter } from './adapters/generic.mjs';
import { transcriptProtocol } from './protocols/transcript.mjs';
import { markdownRenderer } from './renderers/markdown.mjs';
import { LarkCliBackend } from './backends/lark-cli.mjs';
import { Registry } from './core/registry.mjs';
import { ExportEngine } from './core/engine.mjs';
import { FileReceiptStore } from './core/state.mjs';

export function createLarkAnything({ config = {}, adapters = [], protocols = [], renderers = [], backends = [], store } = {}) {
  return new ExportEngine({
    config,
    adapters: new Registry('adapter', [codexAdapter, claudeCodeAdapter, chatgptAdapter, genericAdapter, ...adapters]),
    protocols: new Registry('protocol', [transcriptProtocol, ...protocols]),
    renderers: new Registry('renderer', [markdownRenderer, ...renderers]),
    backends: new Registry('backend', [new LarkCliBackend(config.backends?.['lark-cli']), ...backends]),
    store: store || new FileReceiptStore(config.stateDir || '.larkanything/state'),
  });
}

export { codexAdapter, claudeCodeAdapter, chatgptAdapter, genericAdapter, transcriptProtocol, markdownRenderer, LarkCliBackend, FileReceiptStore, Registry, ExportEngine };
export { loadConfig, resolveOptions } from './core/config.mjs';
export { validateConversation, validateSourceArtifact, MODEL_VERSION } from './core/model.mjs';
export { discoverSessions, resolveSession, resolveSessionSources } from './adapters/discovery.mjs';
export { LarkAnythingError } from './core/errors.mjs';
