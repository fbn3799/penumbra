// Bundles the plugin (dist/code.js) and inlines the UI script into dist/ui.html,
// since Figma loads the UI as a single HTML string.
import * as esbuild from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const watch = process.argv.includes('--watch');

const inlineUi = {
  name: 'inline-ui',
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length) return;
      const html = await readFile('src/ui.html', 'utf8');
      const js = result.outputFiles[0].text;
      await writeFile('dist/ui.html', html.replace('<!-- script -->', () => `<script>${js}</script>`));
    });
  },
};

await mkdir('dist', { recursive: true });

const code = { entryPoints: ['src/code.ts'], bundle: true, target: 'es2017', outfile: 'dist/code.js' };
const ui = { entryPoints: ['src/ui.ts'], bundle: true, target: 'es2017', minify: !watch, write: false, outfile: 'dist/ui.js', plugins: [inlineUi] };

if (watch) {
  for (const options of [code, ui]) await (await esbuild.context(options)).watch();
  console.log('watching src/ …');
} else {
  await Promise.all([esbuild.build(code), esbuild.build(ui)]);
}
