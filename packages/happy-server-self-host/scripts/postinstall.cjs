'use strict';

/**
 * Generates the Prisma client for installed copies of this package.
 *
 * prisma/ is a build artifact here — it is copied from packages/happy-server by
 * build-runtime.cjs and only exists in the published tarball. In a fresh
 * monorepo checkout it is absent, so skip rather than fail the workspace
 * install.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const schema = path.join(root, 'prisma', 'schema.prisma');
const bytesPatch = path.join(root, 'scripts/fix-pglite-prisma-bytes.cjs');
if (fs.existsSync(bytesPatch)) {
  const patch = spawnSync(process.execPath, [bytesPatch], {
    cwd: root, env: { ...process.env, HAPPY_PATCH_ROOT: root }, stdio: 'inherit',
  });
  if (patch.error) throw patch.error;
  if (patch.status !== 0) process.exit(patch.status ?? 1);
}


if (!fs.existsSync(schema)) {
  console.log('happy-server-self-host: no prisma/schema.prisma yet, skipping generate (run build first).');
  process.exit(0);
}

const result = spawnSync('prisma', ['generate', `--schema=${schema}`], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) throw result.error;
// status is null when the process was killed by a signal — treat that as failure
// rather than silently leaving the install without a Prisma client.
process.exit(result.status ?? 1);
