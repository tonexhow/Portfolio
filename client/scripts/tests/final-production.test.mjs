import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {understandUiCommand} from '../chat/tonex-actions.js';
import {CHAT_COMMANDS,parseQuickCommand} from '../chat/slash-commands.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=name=>readFileSync(resolve(root,name),'utf8');

test('Tonex UI action requires real user intent; do not report imaginary actions',()=>{
 assert.deepEqual(understandUiCommand('switch to the other theme'),{type:'theme',value:'toggle'});
 assert.deepEqual(understandUiCommand('please change to light mode'),{type:'theme',value:'light'});
 assert.equal(understandUiCommand('why are themes important?'),null);
});
test('hidden /ai is not exposed in slash lists, while /getaichat is available',()=>{
 for(const items of Object.values(CHAT_COMMANDS))assert.ok(!items.some(x=>x.name==='/ai'));
 assert.equal(parseQuickCommand('/getaichat','bot')?.name,'/getaichat');
 assert.equal(parseQuickCommand('/getaichat','visitor')?.name,'/getaichat');
 assert.equal(parseQuickCommand('/ai','visitor'),null);
});
test('payment status depends on server verification with background retry and WebSocket',()=>{
 const server=read('server/internal/application/payment_reconcile.go');
 assert.match(server,/func \(a \*app\) reconcilePendingPayments/);
 assert.match(server,/a\.refreshCheckoutStatus\(cycle, id\)/);
 assert.match(server,/a\.commitConfirmedCheckout\(ctx, session\)/);
 assert.match(server,/a\.chat\.sendThread\(thread,/);
 const client=read('client/scripts/chat/project-offers.js');
 assert.doesNotMatch(client,/Check payment with PayMongo|verifyCurrentPayment/);
 assert.doesNotMatch(client,/setInterval\(\(\)=>\{if\(!document\.hidden\)void loadOffers/);
 assert.match(client,/recoveryTimer=setTimeout/);
 assert.match(client,/WebSocket project_offer events update/);
 const admin=read('client/scripts/pages/admin/transactions.js');
 assert.doesNotMatch(admin,/Verify with PayMongo/);
});
test('Tonex offers cards based on visitor request only, not model answer',()=>{
 const go=read('server/internal/application/ai.go');
 assert.match(go,/func selectPublishedCards\(s content\.Snapshot, text, _ string\)/);
 assert.match(go,/func askingForPrice/);
 assert.match(go,/human Admin-approved estimate|Admin to review and price/i);
 const js=read('client/scripts/pages/index/career-chat.js');
 assert.match(js,/const allowCards=explicitBrowseIntent\(q\)/);
 assert.match(js,/if\(!answer && pricingRequest\(body\)\)/);
 assert.match(js,/if\(!answer && wantsSocial\(body\)\)/);
 assert.match(js,/className='tonex-processing'/);
 assert.match(js,/botBusy=true/);
});
test('AI handoff is confirmed, persisted and Admin-only diagnostics are protected',()=>{
 const server=read('server/internal/application/chat.go');
 assert.match(server,/func \(a \*app\) publicChatHandoff/);
 assert.match(server,/!in\.Confirmed/);
 assert.match(server,/a\.saveChatMessage\(thread, "visitor"/);
 const routes=read('server/internal/application/routes.go');
 assert.match(routes,/POST \/api\/public\/chat\/handoff", a\.publicChatHandoff/);
 assert.match(routes,/POST \/api\/admin\/ai\/health", a\.requireAdmin\(a\.adminAIHealth\)/);
});
test('AI provider control uses SVG icons and transactional filtering is segmented',()=>{
 const ai=read('client/scripts/pages/admin/artificial-intelligence.js');
 assert.match(ai,/providerGlyph=/);
 assert.match(ai,/selectedIndex=0/);
 assert.match(ai,/iconAction\('eye'/);
 assert.match(ai,/iconAction\('copy'/);
 const html=read('client/htmls/admin.html');
 for(const label of ['Active','Archived','All'])assert.match(html,new RegExp('>'+label+'<'));
 assert.match(read('server/internal/application/transactions.go'),/archived_at IS NULL/);
});
test('greetings are multilingual with minute rotation and Server diagnostics are opt-in',()=>{
 const data=JSON.parse(read('client/assets/data/public-snapshot.json'));
 assert.ok(data.information.greeting.rotation_languages.length>=5);
 assert.ok(Object.keys(data.information.greeting.translations).length>=5);
 assert.match(read('client/scripts/pages/index/index.js'),/renderGreeting\(personal, true\), 60000/);
 const network=read('server/internal/application/network_diagnostics.go');
 assert.match(network,/ipinfo\.io\/json/);
 assert.match(network,/https:\/\/speed\.cloudflare\.com/);
 assert.match(read('server/internal/application/routes.go'),/POST \/api\/admin\/server\/network-check", a\.requireAdmin/);
});
