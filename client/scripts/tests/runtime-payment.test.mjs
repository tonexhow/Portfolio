import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,mkdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import handler,{publicClientConfig,renderPublicConfig} from '../../htmls/vercel/api/runtime-config.js';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const source=rel=>readFile(join(project,rel),'utf8');

test('runtime backend URL is validated and never serialized with secrets',()=>{
 const cfg=publicClientConfig({PUBLIC_API_BASE_URL:'https://service.example',API_ORIGIN:'https://old.example',ACCESS_SECRET:'HIGHLY_PRIVATE',PAYMONGO_SECRET:'SK_PRIVATE'});
 assert.equal(cfg.apiBaseURL,'https://service.example');
 const script=renderPublicConfig(cfg);
 assert.match(script,/"apiBaseURL":"https:\/\/service.example"/);
 assert.doesNotMatch(script,/HIGHLY_PRIVATE|SK_PRIVATE|old.example/);
 for(const url of ['http://bad.example','https://name:pw@host.example','https://api.example/path','https://api.example/?token=123','javascript:alert(1)','//api.example']){
  assert.throws(()=>publicClientConfig({PUBLIC_API_BASE_URL:url}));
 }
 assert.equal(publicClientConfig({PUBLIC_API_BASE_URL:'http://127.0.0.1:48000'}).apiBaseURL,'http://127.0.0.1:48000');
 assert.throws(()=>publicClientConfig({PUBLIC_API_BASE_URL:'https://api.example',PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_secret_private'}));
});
test('Vercel runtime handler sends no-store JS using environment at request time',()=>{
 const old=process.env.PUBLIC_API_BASE_URL;
 const oldSecret=process.env.ACCESS_SECRET;
 try {
  process.env.PUBLIC_API_BASE_URL='https://first.example';
  process.env.ACCESS_SECRET='NEVER_EXPOSE_THIS';
  const invoke=()=>{
   const result={headers:{},body:'',statusCode:0,setHeader(k,v){this.headers[k.toLowerCase()]=v},end(t){this.body=t}};
   handler({method:'GET'},result);return result;
  };
  const first=invoke();assert.equal(first.statusCode,200);assert.match(first.body,/first.example/);
  assert.match(first.headers['cache-control'],/no-store/);
  assert.doesNotMatch(first.body,/NEVER_EXPOSE_THIS/);
  process.env.PUBLIC_API_BASE_URL='https://moved.example';
  const second=invoke();assert.match(second.body,/moved.example/);
  assert.doesNotMatch(second.body,/first.example/);
 }finally{
  if(old===undefined)delete process.env.PUBLIC_API_BASE_URL;else process.env.PUBLIC_API_BASE_URL=old;
  if(oldSecret===undefined)delete process.env.ACCESS_SECRET;else process.env.ACCESS_SECRET=oldSecret;
 }
});
test('Vercel config.js points to request-time function, not stale static asset',async()=>{
 const vercel=JSON.parse(await source('client/htmls/vercel/vercel.json'));
 assert.deepEqual(vercel.rewrites[0],{source:'/config.js',destination:'/api/runtime-config'});
 assert.match(JSON.stringify(vercel.headers),/no-store/);
 const build=await source('client/htmls/vercel/build.mjs');
 assert.match(build,/process.env.VERCEL === "1"/);
 assert.match(build,/rm\(join\(out,"config.js"\)/);
 const compiler=await source('client/scripts/tools/compile-release.mjs');
 assert.match(compiler,/await rm\(join\(deployed,'config.js'\)/);
 assert.match(compiler,/api\/runtime-config.js/);
 assert.match(compiler,/join\(deployed,'vercel.json'\)/);
});
test('non-Vercel static config is replaceable without recompiling',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'jpano-runtime-test-'));
 const dist=join(dir,'dist');await mkdir(dist);
 await writeFile(join(dist,'index.html'),'<!doctype html>');
 const env=join(dir,'.env');
 await writeFile(env,'PUBLIC_API_BASE_URL=https://newbackend.example\nACCESS_SECRET=DO_NOT_LEAK\nPAYMONGO_SECRET=NEVER_IN_JS\n');
 const tool=join(project,'client/scripts/tools/update-runtime-config.mjs');
 const updated=spawnSync(process.execPath,[tool,dist,env],{encoding:'utf8'});
 assert.equal(updated.status,0,updated.stderr);
 const content=await readFile(join(dist,'config.js'),'utf8');
 assert.match(content,/newbackend.example/);
 assert.doesNotMatch(content,/DO_NOT_LEAK|NEVER_IN_JS/);
 await mkdir(join(dist,'api'));
 await writeFile(join(dist,'api/runtime-config.js'),'// Vercel runtime');
 const refused=spawnSync(process.execPath,[tool,dist,env],{encoding:'utf8'});
 assert.notEqual(refused.status,0);
});
test('webhook drives WebSocket; browser only performs one delayed recovery check',async()=>{
 const offers=await source('client/scripts/chat/project-offers.js');
 const chat=await source('client/scripts/pages/index/career-chat.js');
 const adminChats=await source('client/scripts/pages/admin/chats.js');
 const transactions=await source('client/scripts/pages/admin/transactions.js');
 const backend=await source('server/payment_reconcile.go');
 assert.match(offers,/recoveryTimer=setTimeout/);
 assert.match(offers,/\},45000\)/);
 assert.doesNotMatch(offers,/poll=setInterval|verifiedTimer=setInterval|6000\)/);
 assert.match(chat,/if\(data.type==="project_offer"\)offerCard/);
 assert.match(adminChats,/portfolio:payment-update/);
 assert.match(transactions,/portfolio:payment-update/);
 assert.match(transactions,/portfolio:payment-reconnected/);
 assert.match(backend,/a\.chat\.sendThread\(thread/);
 assert.match(backend,/a\.chat\.sendAdmins\(/);
 const ws=await source('server/websocket.go');
 assert.match(ws,/func \(c \*wsConn\) heartbeat/);
 assert.match(ws,/writeFrame\(0x9, nil\)/);
 assert.match(await source('server/chat.go'),/go c\.heartbeat\(heartbeatStop\)/);
});

test('existing cookie-scoped guest chat receives payments while Admin is offline but cannot send messages',async()=>{
 const go=await source('server/chat.go');
 const visitor=await source('client/scripts/pages/index/career-chat.js');
 assert.match(go,/threadID, err := a\.currentChatThread\(r\)/);
 assert.match(go,/if err != nil && !a\.chatAllowedForVisitor\(r\)/);
 const ws=go.slice(go.indexOf('func (a *app) publicChatWS('),go.indexOf('func (a *app) adminChatWS('));
 assert.match(ws,/thread, err := a\.currentChatThread\(r\)/);
 assert.match(ws,/if !a\.chatAllowedForVisitor\(r\)/); // Message write guard still applies.
 assert.doesNotMatch(ws.slice(0,ws.indexOf('upgradeWebSocket')),/if !a\.chatAllowedForVisitor\(r\)/);
 assert.match(visitor,/if\(!status\.available&&!liveStarted&&chatSocket\)/);
 assert.match(visitor,/liveStarted\?"Admin is offline/);
});
