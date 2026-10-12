import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const routes=await readFile(join(root,'server/main.go'),'utf8');
const declared=[...routes.matchAll(/mux\.HandleFunc\("(GET|POST|PATCH|PUT|DELETE) (\/[^\"]+)"/g)].map(x=>({method:x[1],path:x[2]}));
function routeMatches(actual,target){
 const clean=value=>value.split('?')[0].replace(/\/\{[^/]+\}/g,'/{id}');
 const a=clean(actual).split('/'),b=clean(target).split('/');
 return a.length===b.length && a.every((segment,i)=>segment===b[i]||segment==='{id}'||b[i]==='{id}');
}
const sourceFiles=[];
async function addSourceFiles(dir){
 for(const f of await readdir(dir,{withFileTypes:true})){
  const target=join(dir,f.name);
  if(f.isDirectory())await addSourceFiles(target);
  else if(f.isFile() && f.name.endsWith('.js'))sourceFiles.push(target);
 }
}
await addSourceFiles(join(root,'client/scripts'));
const requests=[];
for(const file of sourceFiles){
 const content=await readFile(file,'utf8');
 for(const match of content.matchAll(/\brequest\(\s*([`'"])(\/api\/[^`'"]+)\1/g)) {
  const path=match[2].replace(/\$\{[^}]*\}/g,'{id}').split('?')[0];
  // Dynamic query-only segments are removed; all paths must have a backend route.
  requests.push({path,file});
 }
}
test('every frontend APIManager request maps to an actual Go route',()=>{
 assert.ok(requests.length>=55,`Only found ${requests.length} literal request paths; update matcher if structure changes`);
 const unmatched=requests.filter(({path})=>!declared.some(route=>routeMatches(path,route.path)));
 assert.deepEqual(unmatched.map(({path})=>path),[]);
});
test('OAuth callback/start, payment, websocket, contact and admin endpoints remain wired',()=>{
 for(const [method,path] of [
  ['GET','/auth/feedback/google/start'],['GET','/auth/feedback/google/callback'],
  ['GET','/auth/feedback/github/start'],['GET','/auth/feedback/github/callback'],
  ['GET','/auth/contact/google/start'],['POST','/api/paymongo/webhook'],
  ['POST','/api/public/chat/offers/{id}/checkout'],
  ['POST','/api/public/chat/offers/{id}/verify'],
  ['GET','/api/public/chat/ws'],['GET','/api/admin/chat/ws'],
  ['GET','/api/public/feedback-auth/providers'],
  ['GET','/api/public/contact-auth/session'],
  ['GET','/api/access/events'],['POST','/api/access/otp']
 ])assert.ok(declared.some(route=>route.method===method&&routeMatches(path,route.path)),`Missing backend handler: ${method} ${path}`);
});
test('provider redirect URIs derive from configured backend API_ORIGIN',async()=>{
 const auth=await readFile(join(root,'server/feedback_auth.go'),'utf8');
 const app=await readFile(join(root,'server/main.go'),'utf8');
 const settings=await readFile(join(root,'server/internal/config/config.go'),'utf8');
 assert.match(auth,/func \(a \*app\) feedbackPublicOrigin\(_ \*http\.Request\) string \{ return a\.apiURL \}/);
 assert.match(auth,/"\/auth\/feedback\/" \+ url\.PathEscape\(provider\) \+ "\/callback"/);
 assert.match(app,/apiURL:\s+settings\.APIOrigin/);
 assert.match(settings,/c\.APIOrigin = strings\.TrimRight\(env\("API_ORIGIN"/);
 assert.match(auth,/"redirect_uri":\s+\{callback\}/);
});
