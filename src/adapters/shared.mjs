import { readFile } from 'node:fs/promises';
import { LarkAnythingError } from '../core/errors.mjs';

export async function readJsonLines(input) {
  const text = await readFile(input, 'utf8');
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [{ value: JSON.parse(line), line: index + 1 }]; }
    catch { throw new LarkAnythingError('INVALID_JSONL', `Invalid JSON at line ${index + 1}. The input may be truncated; no content was published.`); }
  });
}

export const textPart = (text, format = 'markdown') => ({ type: 'text', text, format });
export const toolPart = (name, text) => ({ type: 'tool', name: name || 'tool', text: typeof text === 'string' ? text : JSON.stringify(text, null, 2) });
export const visibleContext = text => !/^\s*<(?:environment_context|user_instructions|permissions instructions|external_codex_apps_open_page)(?:\s|>)/.test(text);

export function contentParts(content) {
  if (typeof content === 'string') return content ? [textPart(content)] : [];
  if (!Array.isArray(content)) return content == null ? [] : [{ type: 'unsupported', label: 'Unrecognized content object' }];
  return content.flatMap(part => {
    if (typeof part === 'string') return [textPart(part)];
    if (['text', 'input_text', 'output_text'].includes(part?.type) && typeof part.text === 'string') return [textPart(part.text)];
    if (part?.type === 'tool_use') return [toolPart(part.name, part.input)];
    if (part?.type === 'tool_result') return [toolPart(part.tool_use_id, typeof part.content === 'string' ? part.content : contentParts(part.content).map(p => p.text || p.label || '[image]').join('\n'))];
    if (part?.type === 'thinking' || part?.type === 'redacted_thinking') return [];
    if (['image', 'image_url', 'input_image'].includes(part?.type)) {
      const src = part.image_url?.url || part.image_url || part.source?.url || part.url;
      return typeof src === 'string' && !src.startsWith('data:')
        ? [{ type: 'image', src, label: 'Image' }]
        : [{ type: 'unsupported', label: 'Image attachment (embedded image data was not exported)' }];
    }
    return [{ type: 'unsupported', label: `Attachment/content type: ${part?.type || part?.content_type || 'unknown'}` }];
  });
}
