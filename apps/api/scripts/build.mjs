#!/usr/bin/env node
// Bundles the API into dist/server.js. npm dependencies stay external; the workspace's TypeScript
// source package (@acme/shared) is bundled in because Node does not run it from node_modules.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sharedEntry = path.resolve(apiRoot, '../../packages/shared/src/index.ts');

await build({
  entryPoints: [path.join(apiRoot, 'src/server.ts')],
  outfile: path.join(apiRoot, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  packages: 'external',
  logLevel: 'info',
  plugins: [
    {
      name: 'bundle-workspace-packages',
      setup(pluginBuild) {
        pluginBuild.onResolve({ filter: /^@acme\/shared$/ }, () => ({ path: sharedEntry }));
      },
    },
  ],
});
