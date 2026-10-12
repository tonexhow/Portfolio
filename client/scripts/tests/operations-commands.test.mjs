import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseAdminRichContent,safeAdminImageURL} from '../chat/admin-image.js';
import {CHAT_COMMANDS,parseQuickCommand} from '../chat/slash-commands.js';
const source=relative=>readFileSync(new URL('../../../'+relative,import.meta.url),'utf8');

test('mixed Admin image message keeps introductory text and appends the full image',()=>{
 const result=parseAdminRichContent('admin','Here is your mockup. /img https://images.example.com/demo.jpg');
 assert.equal(result.text,'Here is your mockup.');
 assert.deepEqual(result.bottom,['https://images.example.com/demo.jpg']);
 assert.equal(result.inline.length,0);
});
test('Admin HTML-style image embeds are inline, not sent as executable HTML',()=>{
 const result=parseAdminRichContent('admin','Preview: <img src="https://images.example.com/preview.png">. Nice!');
 assert.equal(result.inline.length,1);assert.equal(result.bottom.length,0);
 assert.equal(result.inline[0].url,'https://images.example.com/preview.png');
 assert.match(result.text,/JPANO_INLINE_IMAGE_0_PLACEHOLDER/);
});
test('only server-authenticated Admin messages can cause image fetches',()=>{
 const payload='Hi <img src="https://tracker.example.com/pixel.png"> /img https://tracker.example.com/x.png';
 const visitor=parseAdminRichContent('visitor',payload);
 assert.equal(visitor.text,payload);assert.deepEqual(visitor.bottom,[]);assert.deepEqual(visitor.inline,[]);
 assert.equal(safeAdminImageURL('https://127.0.0.1/pixel.png'),null);
 assert.equal(safeAdminImageURL('javascript:alert(1)'),null);
 assert.equal(safeAdminImageURL('http://example.com/x.png'),null);
});
test('every requested chat project command is explicitly scoped by role',()=>{
 for(const command of ['/projects','/createproject','/acceptproject','/help','/clear','/img'])assert.ok(CHAT_COMMANDS.admin.some(c=>c.name===command),command);
 for(const command of ['/projects','/createproject','/help','/clear'])assert.ok(CHAT_COMMANDS.visitor.some(c=>c.name===command),command);
 assert.equal(parseQuickCommand('/acceptproject','visitor'),null);
 assert.equal(parseQuickCommand('/img https://example.com/a.jpg','visitor'),null);
 assert.equal(parseQuickCommand('/createproject','admin')?.name,'/createproject');
});
test('operations metadata and payment reconciliation endpoints are Admin-protected',()=>{
 const main=source('server/internal/application/routes.go');
 for(const route of ['/api/admin/database/tables','/api/admin/server/info','/api/admin/server/logs','/api/admin/chats/{id}/inquiries','/api/admin/project-offers/{id}/archive']){
  const line=main.split('\n').find(x=>x.includes(route));assert.match(line||'',/a\.requireAdmin\(/,route);
 }
 const recon=source('server/internal/application/payment_reconcile.go');
 assert.match(recon,/queryPayMongoCheckout/);assert.match(recon,/paymongoSessionPaid/);
 assert.match(recon,/FOR UPDATE/);assert.match(recon,/status='paid',payment_id=\$1/);
 assert.doesNotMatch(source('server/internal/application/project_inquiries.go'),/DELETE FROM portfolio\.project_payment_attempts/);
});
test('schema alignment detects inquiry and archival columns before enabling database features',()=>{
 const validator=source('server/internal/database/database.go');
 for(const value of ['project_inquiries','admin_note','archived_at'])assert.ok(validator.includes(value));
 const schema=source('database/schema.sql');assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS portfolio.project_inquiries'));
});
