import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('AIUI page contains valid JSON metadata and JavaScript syntax', async (context) => {
  const source = await readFile('src/pages/index/index.ink', 'utf8');
  const definition = source.match(/<script[^>]*def>\s*([\s\S]*?)\s*<\/script>/);
  const setup = source.match(/<script setup>\s*([\s\S]*?)\s*<\/script>/);

  assert.ok(definition, 'missing script def block');
  assert.ok(setup, 'missing script setup block');
  assert.doesNotThrow(() => JSON.parse(definition[1]));

  const directory = await mkdtemp(join(tmpdir(), 'echo-ink-check-'));
  const scriptPath = join(directory, 'index.mjs');
  context.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(scriptPath, setup[1], 'utf8');

  const result = spawnSync(process.execPath, ['--check', scriptPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
