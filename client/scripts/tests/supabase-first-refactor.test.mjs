import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const source=file=>readFile(join(root,file),'utf8');
const baseSnapshot={schema_version:1,revision:1,updated_at:'2026-01-01T00:00:00Z',information:{},projects:[],certificates:[],feedback:[],career_profiles:[]};
const liveSnapshot={...baseSnapshot,revision:10,updated_at:'2026-10-12T00:00:00Z',projects:[{key:'published',name:'Published',visible:true,stack:[],images:[]}]};
const response=(data,ok=true)=>({ok,json:async()=>data});
function browserStore({directOK=true, backendOK=true}={}){
 const urls=[],events=[],saved=new Map(); let goCalls=0;
 const win={APP_CONFIG:{apiBaseURL:'https://api.example.com',supabaseURL:'https://sample.supabase.co',supabasePublishableKey:'sb_publishable_TEST_ONLY'},
   APIManager:{request:async()=>{goCalls++;if(!backendOK)throw Error('Go offline');return {...liveSnapshot,revision:11}}}};
 const context={window:win,URL,AbortSignal,JSON,Date,console,document:{baseURI:'https://jpano.dev/',dispatchEvent:e=>events.push(e.type),addEventListener(){}},
   localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,val)=>saved.set(key,val)},
   addEventListener(){},CustomEvent:class{constructor(type){this.type=type;}},
   fetch:async url=>{urls.push(url);
     if(url==='/assets/data/public-snapshot.json')return response(baseSnapshot);
     if(url.includes('/rest/v1/rpc/jpano_public_')){
       if(!directOK)throw Error('Supabase offline');
       return response(url.endsWith('snapshot')?liveSnapshot:liveSnapshot.projects);
     }
     throw Error('unexpected test URL');
   }};
 return {context,win,urls,events,goCalls:()=>goCalls};
}
test('approved portfolio data loads from Supabase first, without contacting Go',async()=>{
 const env=browserStore({backendOK:false});
 vm.runInNewContext(await source('client/scripts/core/public-store.js'),env.context);
 const snapshot=await env.win.PublicStore.refresh();
 assert.equal(snapshot.revision,10);
 assert.equal(snapshot.projects[0].name,'Published');
 assert.equal(env.goCalls(),0,'No backend request should be made when direct Supabase succeeds');
 assert.ok(env.urls.some(url=>url.includes('rpc/jpano_public_snapshot')));
});
test('Go API is a compatibility fallback when the published Supabase RPC fails',async()=>{
 const env=browserStore({directOK:false,backendOK:true});
 vm.runInNewContext(await source('client/scripts/core/public-store.js'),env.context);
 const snapshot=await env.win.PublicStore.refresh();
 assert.equal(snapshot.revision,11);
 assert.equal(env.goCalls(),1);
});
test('Go offline + successful Supabase public RPC reports database online but management not ready',async()=>{
 const win={PublicStore:{apiURL:path=>'https://api.example.com'+path,refreshDirectPublic:async()=>({revision:1})}};
 const ctx={window:win,document:{readyState:'loading',body:{classList:{contains:()=>false}},documentElement:{dataset:{}},querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}},
   fetch:async()=>{throw Error('Go offline')},AbortSignal,console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}}};
 vm.runInNewContext(await source('client/scripts/core/server-status.js'),ctx);
 await win.ServerStatus.check();
 assert.equal(win.ServerStatus.online,false);
 assert.equal(win.ServerStatus.ready,false);
 assert.equal(win.ServerStatus.directPublic,true);
 assert.equal(win.ServerStatus.databaseOnline,true);
 assert.equal(win.ServerStatus.level,'warning');
 assert.equal(ctx.document.documentElement.dataset.publicDatabase,'online');
 assert.equal(ctx.document.documentElement.dataset.serverReady,'not-ready');
});
test('Vercel project root defines /config.js dynamic route and only public runtime values',async()=>{
 const cfg=JSON.parse(await source('vercel.json'));
 assert.equal(cfg.buildCommand,'node client/htmls/vercel/build.mjs');
 assert.equal(cfg.outputDirectory,'client/htmls/vercel/dist');
 assert.ok(cfg.rewrites.some(x=>x.source==='/config.js'&&x.destination==='/api/runtime-config'));
 assert.match(await source('api/runtime-config.mjs'),/api\/runtime-config\.js/);
 const {publicClientConfig,renderPublicConfig}=await import(pathToFileURL(join(root,'client/htmls/vercel/api/runtime-config.js')).href);
 const browser=renderPublicConfig(publicClientConfig({PUBLIC_API_BASE_URL:'https://api.example.com',PUBLIC_SUPABASE_URL:'https://sample.supabase.co',PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_TEST_ONLY',DATABASE_URL:'postgres://private:password@host',SMTP_PASSWORD:'PRIVATE_TEST_ONLY'}));
 assert.match(browser,/https:\/\/api\.example\.com/);
 assert.doesNotMatch(browser,/password@host|PRIVATE_TEST_ONLY|DATABASE_URL|SMTP_PASSWORD/);
});
test('Go entrypoint is at server root; all established routes reside in internal application',async()=>{
 assert.match(await source('server/main.go'),/application\.RunWithStop\(stopChannel\)/);
 const routes=await source('server/internal/application/routes.go');
 assert.equal([...routes.matchAll(/mux\.HandleFunc\("(?:GET|POST|PATCH|PUT|DELETE) /g)].length,111);
 for(const route of ['/api/paymongo/webhook','/api/public/chat/ws','/auth/feedback/{provider}/callback']){
   assert.ok(routes.includes(route),`Preserved ${route}`);
 }
});

test('independent service combinations never confuse Supabase public access with privileged Go readiness',async()=>{
 const text=await source('client/scripts/core/server-status.js');
 async function run({go,db,direct,ai}){
   const win={PublicStore:{apiURL:path=>'https://api.example.com'+path,
     refreshDirectPublic:async()=>direct?{revision:1}:null,refresh:async()=>({})}};
   const doc={readyState:'loading',body:{classList:{contains:()=>false}},documentElement:{dataset:{}},querySelectorAll:()=>[],addEventListener(){},dispatchEvent(){}};
   const ctx={window:win,document:doc,AbortSignal,console,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},fetch:async url=>{
     if(!go)throw Error('Go offline');
     if(String(url).endsWith('/api/health'))return response({online:true,service:'jpano-portfolio-api',database:db,ready:db});
     if(String(url).endsWith('/api/public/ai/status'))return response({online:ai,enabled:ai});
     throw Error('unexpected URL');
   }};
   vm.runInNewContext(text,ctx);
   await win.ServerStatus.check();
   return {online:win.ServerStatus.online,ready:win.ServerStatus.ready,database:win.ServerStatus.databaseOnline,ai:win.ServerStatus.aiOnline,level:win.ServerStatus.level,public:win.ServerStatus.directPublic};
 }
 const both=await run({go:true,db:true,direct:true,ai:true});
 assert.equal(both.level,'good');assert.equal(both.database,true);assert.equal(both.ready,true);
 const publicOnly=await run({go:false,db:false,direct:true,ai:false});
 assert.equal(publicOnly.database,true);assert.equal(publicOnly.ready,false);assert.equal(publicOnly.public,true);
 const apiOnly=await run({go:true,db:false,direct:false,ai:false});
 assert.equal(apiOnly.online,true);assert.equal(apiOnly.database,false);assert.equal(apiOnly.ready,false);
 const nowhere=await run({go:false,db:false,direct:false,ai:false});
 assert.equal(nowhere.level,'danger');assert.equal(nowhere.database,false);
});
