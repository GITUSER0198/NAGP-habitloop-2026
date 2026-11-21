import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('standalone Lambda bundles', () => {
  it.each(['event-normalizer', 'analytics-updater'])('loads %s as handler.js without workspace dependencies or module detection', name => {
    const bundle = readFileSync(new URL(`../../../lambdas/${name}/dist/handler.js`, import.meta.url), 'utf8');
    const script = `
      const { Module, isBuiltin } = require('node:module');
      const { join } = require('node:path');
      const { tmpdir } = require('node:os');
      const assert = require('node:assert/strict');
      const file = join(tmpdir(), 'isolated-lambda', 'handler.js');
      const isolated = new Module(file);
      isolated.filename = file;
      isolated.paths = [];
      const originalRequire = isolated.require.bind(isolated);
      isolated.require = name => {
        if (!isBuiltin(name) && !name.startsWith('@aws-sdk/')) throw new Error('Unexpected dependency: ' + name);
        return originalRequire(name);
      };
      isolated._compile(require('node:fs').readFileSync(0, 'utf8'), file);
      (async () => {
        assert.deepEqual(await isolated.exports.handler({ Records: [] }), { batchItemFailures: [] });
        assert.deepEqual(await isolated.exports.handler({ Records: [
          { messageId: 'bad-json', body: '{' }, { messageId: 'bad-detail', body: 'null' }
        ] }), { batchItemFailures: [{ itemIdentifier: 'bad-json' }, { itemIdentifier: 'bad-detail' }] });
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    const result = spawnSync(process.execPath, ['--no-experimental-detect-module', '--no-experimental-require-module', '-e', script], {
      input: bundle, encoding: 'utf8', env: { ...process.env, NODE_PATH: '' }, timeout: 10_000
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
