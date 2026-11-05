import { readFile } from 'node:fs/promises';
import { validateConversation } from '../core/model.mjs';

export const genericAdapter = {
  id: 'generic', version: 1,
  async load({ input, title }) {
    const model = JSON.parse(await readFile(input, 'utf8'));
    if (title) model.title = title;
    return validateConversation(model);
  },
};
