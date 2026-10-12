// Release gate: scan the generated frontend for configured private credentials.
// Safe with a real local .env. Never print or serialize the credential itself.
// Also supports a temporary fixture during unit tests:
//   node verify-client-secrets.mjs /path/to/dist /path/to/private.env
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const dist = resolve(process.argv[2] || join(project, 'client/htmls/vercel/dist'));
const envFile = resolve(process.argv[3] || join(project, '.env'));
export const PRIVATE_KEYS = new Set([
  'DATABASE_URL','DATABASE_POOLER_URL','SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY',
  'SMTP_PASSWORD','ACCESS_SECRET','GOOGLE_CLIENT_SECRET','GITHUB_CLIENT_SECRET',
  'FACEBOOK_CLIENT_SECRET','FACEBOOK_APP_SECRET','TELEGRAM_BOT_TOKEN',
  'KAABAG_API_KEY','AI_KEY_ENCRYPTION_KEY','PAYMONGO_SECRET','PAYMONGO_WEBHOOK_SECRET'
]);
const secrets = new Map();
function add(key, value) {
  if (!PRIVATE_KEYS.has(key)) return;
  let normalized = String(value || '').trim();
  if (normalized.length >= 2 && ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith("'") && normalized.endsWith("'")))) normalized = normalized.slice(1,-1);
  // Placeholders are not credentials; short strings can be ordinary UI copy.
  if (normalized.length >= 12 && !/YOUR_|PLACEHOLDER|REPLACE_ME|CHANGEME/i.test(normalized)) secrets.set(key,normalized);
}
try {
  const file = await readFile(envFile, 'utf8');
  for (const line of file.split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const match = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=\s*(.*)$/);
    if (match) add(match[1],match[2]);
  }
} catch(error) { if (error.code !== 'ENOENT') throw error; }
for (const key of PRIVATE_KEYS) add(key,process.env[key]);
const textExtensions = new Set(['.html','.js','.json','.css','.svg','.txt','.xml','.map','.webmanifest']);
let checked=0;
async function scan(dir) {
  for (const item of await readdir(dir,{withFileTypes:true})) {
    const file=join(dir,item.name);
    if (item.isDirectory()) { await scan(file); continue; }
    if (!item.isFile() || !textExtensions.has(extname(item.name).toLowerCase())) continue;
    const text=await readFile(file,'utf8');
    checked++;
    for(const [key,value] of secrets) {
      if(text.includes(value)) {
        // Only key name + relative file; no values or lines with credentials.
        console.error(`SECRET_EXPOSED: ${key} found in a browser build file: ${file.slice(dist.length+1)}`);
        process.exitCode=1;
      }
    }
  }
}
await scan(dist);
if (process.exitCode) console.error('Release blocked. Remove private credentials from public assets and rotate exposed values.');
else console.log(`PASS: ${checked} browser files checked; no configured server secrets exposed.`);
