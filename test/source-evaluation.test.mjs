import test from 'node:test';
import { cases } from '../scripts/evaluation/source-cases.mjs';
for (const item of cases) test(`${item.id}: ${item.title}`, item.run);
