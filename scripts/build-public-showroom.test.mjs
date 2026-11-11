import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./build-public-showroom.mjs', import.meta.url));
const repo = path.resolve(path.dirname(script), '..');

function build(env = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, SHOWROOM_API_BASE_URL: '', SHOWROOM_SUPABASE_URL: '', SHOWROOM_SUPABASE_PUBLISHABLE_KEY: '', ...env },
    encoding: 'utf8',
  });
}

function readConfig() {
  return fs.readFileSync(path.join(repo, 'public-showroom/config.js'), 'utf8');
}

test('build emits an empty safe config when no data source is configured', () => {
  const result = build();
  assert.equal(result.status, 0, result.stderr);
  const config = readConfig();
  assert.ok(config.includes('"apiBaseUrl":""'));
  assert.ok(config.includes('"supabaseUrl":""'));
  assert.ok(config.includes('"supabasePublishableKey":""'));
});

test('build accepts HTTPS API base URLs and strips a trailing slash', () => {
  const result = build({ SHOWROOM_API_BASE_URL: 'https://catalog.example.test/' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(readConfig().includes('"apiBaseUrl":"https://catalog.example.test"'));
});

test('build rejects non-HTTPS API base URLs', () => {
  const result = build({ SHOWROOM_API_BASE_URL: 'http://insecure.example.test' });
  assert.notEqual(result.status, 0);
});

test('build accepts a Supabase HTTPS origin and publishable key', () => {
  const result = build({
    SHOWROOM_SUPABASE_URL: 'https://project.supabase.co/',
    SHOWROOM_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key'
  });
  assert.equal(result.status, 0, result.stderr);
  const config = readConfig();
  assert.ok(config.includes('"supabaseUrl":"https://project.supabase.co"'));
  assert.ok(config.includes('"supabasePublishableKey":"sb_publishable_test_key"'));
});

test('build requires Supabase URL and key together', () => {
  const result = build({ SHOWROOM_SUPABASE_URL: 'https://project.supabase.co' });
  assert.notEqual(result.status, 0);
});

test('build rejects legacy JWT keys that could contain service-role credentials', () => {
  const result = build({
    SHOWROOM_SUPABASE_URL: 'https://project.supabase.co',
    SHOWROOM_SUPABASE_PUBLISHABLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature'
  });
  assert.notEqual(result.status, 0);
});

test('build rejects a service-role-like key', () => {
  const result = build({
    SHOWROOM_SUPABASE_URL: 'https://project.supabase.co',
    SHOWROOM_SUPABASE_PUBLISHABLE_KEY: 'service_role_secret'
  });
  assert.notEqual(result.status, 0);
});

test('build rejects non-HTTPS Supabase URLs', () => {
  const result = build({
    SHOWROOM_SUPABASE_URL: 'http://project.supabase.co',
    SHOWROOM_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key'
  });
  assert.notEqual(result.status, 0);
});
