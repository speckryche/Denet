import * as esbuild from 'esbuild';
import path from 'path';
// repo root = two levels up from scripts/bitstop-harness/
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const here = path.dirname(new URL(import.meta.url).pathname);
await esbuild.build({
  entryPoints: [path.join(here, 'harness.mts')],
  bundle: true, platform: 'node', format: 'esm', target: 'node20',
  outfile: path.join(here, 'harness.mjs'),
  absWorkingDir: ROOT, nodePaths: [path.join(ROOT, 'node_modules')], logLevel: 'warning',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  plugins: [{ name: 'alias', setup(b) {
    b.onResolve({ filter: /^@\// }, a => b.resolve('./src/' + a.path.slice(2), { resolveDir: ROOT, kind: a.kind }));
  }}],
});
