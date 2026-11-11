import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./build-public-showroom.mjs', import.meta.url));
const repo = path.resolve(path.dirname(script), '..');

function build(apiBaseUrl) {
  return spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, SHOWROOM_API_BASE_URL: apiBaseUrl },
    encoding: 'utf8',
  });
}

test('build emits an empty safe config when API origin is not configured', () => {
  const result = build('');
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(repo, 'public-showroom/config.js'), 'utf8');
  assert.ok(config.includes('"apiBaseUrl":""'));
});

test('build accepts HTTPS API base URLs and strips a trailing slash', () => {
  const result = build('https://catalog.example.test/');
  assert.equal(result.status, 0, result.stderr);
  const config = fs.readFileSync(path.join(repo, 'public-showroom/config.js'), 'utf8');
  assert.ok(config.includes('"apiBaseUrl":"https://catalog.example.test"'));
});

test('build rejects non-HTTPS API base URLs', () => {
  const result = build('http://insecure.example.test');
  assert.notEqual(result.status, 0);
});
