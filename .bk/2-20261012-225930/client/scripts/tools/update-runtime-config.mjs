// Update a standalone static host's PUBLIC config.js without rebuilding JS,
// HTML, CSS or Go. Vercel deployments use api/runtime-config.js instead.
// Usage: node client/scripts/tools/update-runtime-config.mjs [dist-directory] [env-file]
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {publicClientConfig,renderPublicConfig} from '../../htmls/vercel/api/runtime-config.js';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const dist=resolve(process.argv[2] || join(project,'client/htmls/vercel/dist'));
const source=resolve(process.argv[3] || join(project,'.env'));
const exists=path=>stat(path).then(s=>s.isFile()).catch(()=>false);
if(!(await exists(join(dist,'index.html'))))throw new Error('Expected a prebuilt static site containing index.html. No build will be run.');
if(await exists(join(dist,'api/runtime-config.js')))throw new Error('This is a Vercel runtime-function release. Set PUBLIC_API_BASE_URL in Vercel instead of writing a static config.js.');
const values={};
for(const raw of (await readFile(source,'utf8')).replace(/^\uFEFF/,'').split(/\r?\n/)){
 const line=raw.trim();if(!line||line.startsWith('#'))continue;
 const m=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);if(!m)continue;
 let value=m[2].trim();if(value.length>1&&((value[0]==='"'&&value.at(-1)==='"')||(value[0]==="'"&&value.at(-1)==="'")))value=value.slice(1,-1);
 values[m[1]]=value;
}
const config=publicClientConfig({
 PUBLIC_API_BASE_URL:values.PUBLIC_API_BASE_URL||values.API_ORIGIN,
 PUBLIC_SUPABASE_URL:values.PUBLIC_SUPABASE_URL,
 PUBLIC_SUPABASE_PUBLISHABLE_KEY:values.PUBLIC_SUPABASE_PUBLISHABLE_KEY
});
await writeFile(join(dist,'config.js'),renderPublicConfig(config));
console.log(`Updated the public runtime config only: ${join(dist,'config.js')}`);
console.log(`Browser API origin: ${config.apiBaseURL}. Do not expose private server .env files.`);
