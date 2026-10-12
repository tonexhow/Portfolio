import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {safeAdminImageURL,parseAdminRichContent} from '../chat/admin-image.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=relative=>readFile(join(root,relative),'utf8');

test('visitor layout now loads shared operations/dialog stylesheet',async()=>{
 const index=await read('client/htmls/index.html');
 const admin=await read('client/htmls/admin.html');
 assert.match(index,/operations\.css\?v=/);
 assert.match(admin,/operations\.css\?v=/);
 const css=await read('client/styles/operations.css');
 for(const selector of ['.chat-command-help-dialog','.project-inquiry-modal','.slash-picker','#toastRegion','.admin-confirm-dialog'])assert.ok(css.includes(selector));
 const clamp=await read('client/styles/chat-enhancements.css');
 assert.match(clamp,/line-clamp:2;-webkit-line-clamp:2/);
});
test('private chat images are role-scoped and resist unsafe schemes',()=>{
 const id='ci_'+('A'.repeat(27));const relative='/api/chat/images/'+id;
 assert.equal(safeAdminImageURL(relative),relative);
 assert.equal(safeAdminImageURL('data:image/png;base64,AAAA'),null);
 assert.equal(safeAdminImageURL('javascript:alert(1)'),null);
 assert.equal(safeAdminImageURL('/api/admin/ai/providers'),null);
 const msg=parseAdminRichContent('admin',`Welcome <img src="${relative}"> another photo /img ${relative}`);
 assert.equal(msg.inline.length,1);
 assert.equal(msg.bottom.length,1);
 assert.equal(msg.bottom[0],relative);
 const visitor=parseAdminRichContent('visitor',`<img src="${relative}"> /img ${relative}`);
 assert.equal(visitor.inline.length,0);
 assert.equal(visitor.bottom.length,0);
});
test('Admin nav follows requested order',async()=>{
 const html=await read('client/htmls/admin.html');
 const nav=html.match(/<nav class="management-nav">([\s\S]*?)<\/nav>/)?.[1];
 assert.ok(nav);
 assert.deepEqual([...nav.matchAll(/data-admin-view="([^"]+)"/g)].map(m=>m[1]),[
  'overview','dashboard','chats','transactions','projects','certificates','career','feedbacks','contacts','artificial-intelligence','database','server']);
});
test('private data inspector routes and migration are protected',async()=>{
 const routes=await read('server/main.go');
 assert.match(routes,/\/api\/admin\/database\/tables\/\{schema\}\/\{table\}\/rows", a\.requireAdmin/);
 assert.match(routes,/POST \/api\/admin\/chat\/images", a\.requireAdmin/);
 const rows=await read('server/database_rows.go');
 assert.match(rows,/safeTableName/);assert.match(rows,/redactDatabaseColumn/);
 assert.match(rows,/limit = 20/);assert.match(rows,/ORDER BY ctid/);
 const media=await read('server/chat_images.go');
 assert.match(media,/a\.currentChatThread\(r\)/);
 assert.match(media,/image\/jpeg/);assert.match(media,/private, no-store/);
 const schema=await read('database/schema.sql');assert.match(schema,/CREATE TABLE IF NOT EXISTS chat_images/);
});
test('Live mode remains explicit and AI keys stay server encrypted',async()=>{
 const pay=await read('server/project_offers.go');
 assert.match(pay,/PAYMONGO_ALLOW_LIVE/);
 assert.match(pay,/Live checkout is currently disabled/);
 const ai=await read('server/ai_gateway.go');
 assert.match(ai,/encryption_state/);assert.match(ai,/rows\.Err\(\)/);
 const env=await read('.env');
 // A developer's untracked .env can legitimately contain credentials.
 // The release checks must prevent those values from reaching client/dist,
 // rather than requiring credentials to be erased during local compilation.
 for(const name of ['PAYMONGO_SECRET','DATABASE_URL','AI_KEY_ENCRYPTION_KEY','SUPABASE_SECRET_KEY','ACCESS_SECRET']){
  assert.match(env,new RegExp('^'+name+'=','m'));
 }
 assert.match(env,/^PAYMONGO_ALLOW_LIVE=(?:true|false)$/m);
 assert.match(await read('.gitignore'),/(?:^|\n)\.env(?:\n|$)/);
});
test('Windows launcher keeps separate Go and frontend terminals',async()=>{
 const cmd=await read('run.bat');
 assert.match(cmd,/cmd \/k/);
 assert.match(cmd,/go run \./);
 assert.match(cmd,/npm run build/);
 assert.match(cmd,/serve dist -l 3000/);
});
