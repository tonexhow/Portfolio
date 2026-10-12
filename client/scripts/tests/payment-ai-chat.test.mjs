import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {adminImageURL} from '../chat/admin-image.js';
import {CHAT_COMMANDS,parseQuickCommand} from '../chat/slash-commands.js';
import {extractAttachmentText} from '../chat/text-attachments.js';

const root=new URL('../../../',import.meta.url);
const source=p=>readFileSync(new URL(p,root),'utf8');

test('only Admin messages may use rich image commands',()=>{
  assert.equal(adminImageURL('visitor','/img https://images.example.com/test.png'),null);
  assert.equal(adminImageURL('assistant','<img https://images.example.com/test.png>'),null);
  assert.equal(adminImageURL('admin','/img https://images.example.com/test.png'),'https://images.example.com/test.png');
  assert.equal(adminImageURL('admin','<img www.example.com/me.jpg>'),'https://www.example.com/me.jpg');
});
test('admin image commands deny dangerous URL schemes and local destinations',()=>{
  const entries=['javascript:alert(1)','http://example.com/a.jpg','https://localhost/private.jpg','https://127.0.0.1/private.jpg','https://[::1]/private.jpg','https://intranet.local/private.jpg','https://user:password@example.com/x.png','https://images.example.com:444/a.png'];
  for(const value of entries)assert.equal(adminImageURL('admin',`/img ${value}`),null,value);
  assert.equal(adminImageURL('admin','hello /img https://example.com/photo.jpg'),null);
});
test('slash-command lists are role-specific and support explicit arguments',()=>{
  assert.equal(parseQuickCommand('/IMG www.example.com/p.jpg','admin')?.name,'/img');
  assert.equal(parseQuickCommand('/img www.example.com/p.jpg','admin')?.arg,'www.example.com/p.jpg');
  assert.equal(parseQuickCommand('/img https://x.com/a.png','visitor'),null);
  assert.equal(parseQuickCommand('/acceptproject','visitor'),null);
  assert.equal(parseQuickCommand('/payments','visitor')?.name,'/payments');
  assert.equal(parseQuickCommand('/getaichat','visitor')?.name,'/getaichat');
  assert.ok(CHAT_COMMANDS.admin.some(x=>x.name==='/transactions'));
});
test('text attachment parser handles common files locally with size and type limits',async()=>{
  const text=new File(['Hello\nPortfolio'], 'scope.txt',{type:'text/plain'});
  assert.deepEqual(await extractAttachmentText(text),{ext:'txt',text:'Hello\nPortfolio',filename:'scope.txt'});
  await assert.rejects(extractAttachmentText(new File(['xxx'],'archive.exe')), /Supported:/);
  await assert.rejects(extractAttachmentText({name:'too-big.txt',size:5*1024*1024}),/4 MB/);
});
test('payment and AI route wiring preserves private scope and signed webhook',()=>{
  const routes=source('server/internal/application/routes.go');
  const payments=source('server/internal/application/project_offers.go');
  const reconciliation=source('server/internal/application/payment_reconcile.go');
  const ai=source('server/internal/application/ai_gateway.go');
  const schema=source('database/schema.sql');
  for(const route of ['/api/admin/transactions','/api/admin/ai/providers','/api/admin/ai/reply-drafts']){
    const line=routes.split('\n').find(l=>l.includes(route));
    assert.ok(line?.includes('a.requireAdmin('),route+' should be Admin only');
  }
  assert.ok(payments.includes('verifyPayMongoSignature'));
  assert.ok(reconciliation.includes('status=\'paid\',payment_id=$1'));
  assert.ok(payments.includes('checkout_session.payment.paid'));
  assert.ok(ai.includes('AI_KEY_ENCRYPTION_KEY'));
  assert.ok(ai.includes('json:"api_key"'));
  assert.ok(schema.includes('portfolio.ai_provider_configs'));
  assert.ok(schema.includes('portfolio.project_payment_attempts'));
});
test('production client output excludes private service secrets even with configured local env',()=>{
  // The private, gitignored .env is permitted to have configured secrets.
  // Every build must instead scan the actual public client output for leaks.
  const env=source('.env.example');
  assert.match(env,/^PAYMONGO_ALLOW_LIVE=(?:true|false)$/m);
  for(const name of ['DATABASE_URL','SUPABASE_SECRET_KEY','PAYMONGO_SECRET','ACCESS_SECRET']){
    assert.match(env,new RegExp('^'+name+'=','m'));
  }
  const compiler=source('client/scripts/tools/compile-release.mjs');
  const verifier=source('client/scripts/tools/verify-client-secrets.mjs');
  assert.match(compiler,/verify-client-secrets\.mjs/);
  assert.match(verifier,/PRIVATE_KEYS/);
  assert.match(verifier,/SECRET_EXPOSED/);
  assert.match(source('client/scripts/tools/split-env.mjs'),/clientKeys\.has\(key\)/);
});

test('GFM tables remain renderable after an introductory paragraph',async()=>{
  const {renderChatMarkdown}=await import('../chat/chat-markdown.js');
  const html=renderChatMarkdown('Here is the status.\n\n| Feature | Status |\n|:--|--:|\n| Markdown | Ready |\n| AI | Testing |');
  assert.ok(html.includes('<table>'),html);
  assert.ok(html.includes('text-align:right'),html);
  assert.ok(!html.includes('tableDelimPattern'));
});

test('Markdown remote images are disabled for visitor/bot rendering',async()=>{
  const {renderChatMarkdown}=await import('../chat/chat-markdown.js');
  const unsafe='![surprise](https://tracker.example.com/pixel.gif)';
  assert.doesNotMatch(renderChatMarkdown(unsafe,{allowImages:false}),/<img\b/i);
  assert.match(renderChatMarkdown(unsafe,{allowImages:true}),/<img\b/i);
});
