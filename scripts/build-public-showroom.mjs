import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public-showroom');
const output = path.join(root, 'config.js');
const rawApi = (process.env.SHOWROOM_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
const rawSupabaseUrl = (process.env.SHOWROOM_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const publishableKey = (process.env.SHOWROOM_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

if (rawApi && (!/^https:\/\//i.test(rawApi) || /[\r\n"'<>]/.test(rawApi))) {
  throw new Error('SHOWROOM_API_BASE_URL must be a valid HTTPS origin or base URL.');
}
if (Boolean(rawSupabaseUrl) !== Boolean(publishableKey)) {
  throw new Error('Set both SHOWROOM_SUPABASE_URL and SHOWROOM_SUPABASE_PUBLISHABLE_KEY, or leave both empty.');
}
if (rawSupabaseUrl) {
  let parsed;
  try { parsed = new URL(rawSupabaseUrl); } catch { throw new Error('SHOWROOM_SUPABASE_URL must be a valid HTTPS URL.'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new Error('SHOWROOM_SUPABASE_URL must be an HTTPS project origin without credentials, path, query, or fragment.');
  }
  if (!publishableKey.startsWith('sb_publishable_') && !publishableKey.startsWith('eyJ')) {
    throw new Error('SHOWROOM_SUPABASE_PUBLISHABLE_KEY must be a Supabase publishable key (or legacy anon key).');
  }
  if (/[\r\n"'<>]/.test(publishableKey)) throw new Error('SHOWROOM_SUPABASE_PUBLISHABLE_KEY contains invalid characters.');
}

fs.mkdirSync(root, { recursive: true });
const config = {
  apiBaseUrl: rawApi,
  supabaseUrl: rawSupabaseUrl,
  supabasePublishableKey: publishableKey,
};
fs.writeFileSync(
  output,
  '// Generated at build time. Publishable keys are public; never put service-role or secret keys here.\n' +
    'window.SHOWROOM_CONFIG = Object.freeze(' + JSON.stringify(config) + ');\n',
  'utf8',
);
console.log(rawSupabaseUrl ? 'Public showroom configured for Supabase read-only access.' : rawApi ? 'Public showroom configured with HTTPS API origin.' : 'Public showroom built without a data source; records remain unavailable until configured.');
