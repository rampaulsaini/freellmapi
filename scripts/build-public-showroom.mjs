import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('public-showroom');
const output = path.join(root, 'config.js');
const raw = (process.env.SHOWROOM_API_BASE_URL ?? '').trim().replace(/\/+$/, '');

if (raw && (!/^https:\/\//i.test(raw) || /[\r\n"'<>]/.test(raw))) {
  throw new Error('SHOWROOM_API_BASE_URL must be a valid HTTPS origin or base URL.');
}

fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(
  output,
  '// Generated at build time. Public URL only; never put secrets here.\n' +
    'window.SHOWROOM_CONFIG = Object.freeze(' +
    JSON.stringify({ apiBaseUrl: raw }) +
    ');\n',
  'utf8',
);
console.log(raw ? 'Public showroom configured with HTTPS API origin.' : 'Public showroom built without an API origin; records remain unavailable until configured.');
