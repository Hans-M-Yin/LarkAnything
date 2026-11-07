// Build the shared React UI with a stubbed host API for renderer-only tests.
import './tauri/build.mjs';
import { build } from 'esbuild';
import { cp, readFile, writeFile } from 'node:fs/promises';
await cp('desktop/tauri-dist', '.larkanything/test-ui', { recursive: true });
await build({ entryPoints: ['desktop/ui/app.tsx'], tsconfig: 'desktop/tsconfig.json', bundle: true, outfile: '.larkanything/test-ui/app.js', platform: 'browser', format: 'iife', target: ['chrome110', 'safari16.4'], minify: true, define: { 'process.env.NODE_ENV': '"production"' } });
// This fixture is opened with file://, where browser module imports are blocked.
const html = await readFile('.larkanything/test-ui/index.html', 'utf8');
await writeFile('.larkanything/test-ui/index.html', html.replace('<script type="module"', '<script'));
