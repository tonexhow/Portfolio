import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pricingRequest,pricingScope,pricingDiscovery} from '../chat/pricing-guidance.js';
import {understandUiCommand,parseUiRequest} from '../chat/tonex-actions.js';
import {CHAT_COMMANDS,parseQuickCommand} from '../chat/slash-commands.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const read=path=>readFileSync(resolve(root,path),'utf8');
test('pricing without features discovers scope but does not invent a fixed price',()=>{
  assert.equal(pricingRequest('How much?'),true);
  assert.equal(pricingScope('How much?',[]).hasScope,false);
  assert.match(pricingDiscovery('how much?',[]),/features or screens/i);
  assert.doesNotMatch(pricingDiscovery('how much?',[]),/₱\s*\d/);
});
test('pricing with a previous concrete feature list is not blocked again',()=>{
  const history=[{role:'user',content:`I need a website for my freelance business.
- Homepage: short bio with contact buttons
- Projects section: gallery and full details
- Contact form: send email and store enquiries
- Blog section: publish articles with categories
- Authentication: Admin login and password reset
- Admin dashboard: manage projects, documents and messages.`}];
  const scope=pricingScope('How much? Please give a worklist.',history);
  assert.equal(scope.hasScope,true);
  const guidance=pricingDiscovery('How much?',history);
  assert.match(guidance,/already outlined useful requirements/i);
  assert.match(guidance,/worklist|working scope/i);
  const server=read('server/internal/application/ai.go');
  assert.match(server,/visitorHasProjectScope\(in\)/);
  assert.match(server,/PRICE INQUIRY WITH PRIOR VISITOR SCOPE/);
  assert.match(read('client/scripts/pages/index/career-chat.js'),/if\(pricingScope\(body,history\)\.hasScope\)/);
});
test('theme follow-up executes only after a theme conversation',()=>{
  assert.deepEqual(understandUiCommand('yes, change it to dark, thanks','We were talking about the theme'),{type:'theme',value:'dark'});
  assert.equal(understandUiCommand('yes, change it to dark','Tell me about my blog'),null);
  assert.deepEqual(understandUiCommand('Please switch the website theme to light'),{type:'theme',value:'light'});
  assert.deepEqual(parseUiRequest('yes change it to dark. also, give me a list of languages','previous theme'),{
    command:{type:'theme',value:'dark'},remainder:'give me a list of languages'
  });
  assert.equal(understandUiCommand('How can I make a dark code editor?'),null);
});
test('manual /theme is explicit, while privileged /ai stays hidden',()=>{
  assert.equal(parseQuickCommand('/theme dark','bot')?.arg,'dark');
  assert.ok(CHAT_COMMANDS.bot.some(c=>c.name==='/theme'));
  assert.ok(!CHAT_COMMANDS.bot.some(c=>c.name==='/ai'));
  assert.match(read('client/scripts/pages/index/career-chat.js'),/command\.name==='\/theme'/);
});
test('composer has consistent size token for all controls',()=>{
  const css=read('client/styles/chat-enhancements.css');
  assert.match(css,/--chat-control-height:48px/);
  assert.match(css,/--chat-control-height:44px/);
  assert.match(css,/\.chat-attach-button,button\[type="submit"\]/);
  assert.match(css,/min-height:var\(--chat-control-height\)!important/);
  assert.match(read('client/scripts/chat/chat-composer.js'),/controlHeight/);
});
test('PayMongo recovery is quicker but payments remain server-verified',()=>{
  const reconcile=read('server/internal/application/payment_reconcile.go');
  assert.match(reconcile,/time\.NewTicker\(25 \* time\.Second\)/);
  assert.match(reconcile,/lastChecked/);
  assert.match(reconcile,/refreshCheckoutStatus\(cycle, id\)/);
  const visitor=read('client/scripts/chat/project-offers.js');
  assert.match(visitor,/checkTrustedPendingPayment/);
  assert.match(visitor,/verifyOfferPayment\(id\)/);
  assert.match(visitor,/if\(result\.verified\)/);
  assert.doesNotMatch(visitor,/Check payment with PayMongo/);
  const checkout=read('server/internal/application/project_offers.go');
  assert.match(checkout,/checkout_return=1/);
  assert.match(checkout,/Never from the visitor's redirect|only a signed checkout_session\.payment\.paid/i);
});
test('compile.bat and compile orchestrator never publish private keys to client build',()=>{
  const bat=read('compile.bat');
  assert.match(bat,/compile-release\.mjs/);
  const compiler=read('client/scripts/tools/compile-release.mjs');
  assert.match(compiler,/GOOS:os,GOARCH:arch,CGO_ENABLED:'0'/);
  assert.match(compiler,/split-env\.mjs/);
  assert.match(compiler,/env\/server/);
  assert.match(compiler,/client\/dist/);
  assert.match(compiler,/windows\/jpano-portfolio\.exe/);
  assert.match(compiler,/linux\/jpano-portfolio/);
  assert.match(compiler,/macos\/jpano-portfolio-arm64/);
  assert.doesNotMatch(compiler,/cp\(join\(source,'\.env'\)/);
  // A developer's private .env legitimately contains configured credentials.
  // Never enforce empty secrets in the source environment: enforce isolation
  // at the CLIENT OUTPUT boundary instead, even with populated keys.
  const verifier=read('client/scripts/tools/verify-client-secrets.mjs');
  assert.match(compiler,/verify-client-secrets\.mjs/);
  assert.match(verifier,/PRIVATE_KEYS/);
  assert.match(verifier,/SECRET_EXPOSED/);
  assert.match(read('client/scripts/tools/split-env.mjs'),/clientKeys\.has\(key\)/);
  assert.match(read('server/internal/application/project_offers.go'),/PAYMONGO_ALLOW_LIVE/);
});
