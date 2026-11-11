import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./build-public-showroom.mjs', import.meta.url));
const repo = path.resolve(path.dirname(script), '..');

test('build emits an empty safe config when API origin is not configured', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, SHOWROOM_API_BASE_URL: '' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(repo, 'public-showroom/config.js'), 'utf8');
  assert.match(config, /apiBaseUrl":""/);
});

test('build accepts HTTPS API base URLs', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, SHOWROOM_API_BASE_URL: 'https://catalog.example.test/' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(repo, 'public-showroom/config.js'), 'utf8');
  assert.match(config, /https:\\/\\/catalog\.example\.test/);
});

test('build rejects non-HTTPS API base URLs', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, SHOWROOM_API_BASE_URL: 'http://insecure.example.test' },
    encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
});
