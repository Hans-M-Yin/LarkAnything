import { readFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { hash } from '../core/model.mjs';

export const markdownFileAdapter = {
  id: 'obsidian', version: 1,
  async load({ input, title }) {
    const path = resolve(input);
    const body = await readFile(path, 'utf8');
    if (!body.trim()) throw new Error('文档为空。');
    return { version: 1, kind: 'markdown-file', id: hash(path), title: title || basename(path, '.md'),
      body, source: { channel: 'obsidian', uri: path, completeness: 'complete' },
      warnings: /!?\[\[[\s\S]*?\]\]/.test(body) ? [{ code: 'OBSIDIAN_REFERENCES', message: '双向链接与嵌入保留为源码，附件尚未上传。' }] : [] };
  },
};

export const markdownFileProtocol = {
  id: 'markdown-file', version: 1, inputKinds: ['markdown-file'],
  format(model, options) {
    return { version: 1, kind: 'document', title: model.title, source: model.source,
      nodes: [{ type: 'markdown', text: model.body }],
      warnings: model.warnings, unsupported: options.unsupported || 'warn',
      coverage: { sourceMessages: 0, publishedMessages: 0, excludedToolItems: 0 } };
  },
};
