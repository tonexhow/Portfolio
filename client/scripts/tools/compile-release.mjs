/* compile.bat entrypoint: cross-compile Go + build static Vercel output.
 * The generated sibling folder contains PRIVATE server env. Never publish the
 * entire folder to Vercel. No secret values are logged or put in client/dist.
 */
import {spawnSync} from 'node:child_process';
import {dirname,join,resolve,relative,isAbsolute,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,stat,readFile,writeFile,readdir,rm,cp,chmod} from 'node:fs/promises';
const source=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const output=resolve(source,'..','jpano-portfolio');
const mode=String(process.argv[2]||'local').toLowerCase();
const deployOrigin=String(process.argv[3]||'').trim();
if(!['local','production'].includes(mode))throw new Error('Usage: compile.bat local OR compile.bat production https://your-public-backend');
if(mode==='production' && deployOrigin){
  const u=new URL(deployOrigin);
  if(u.protocol!=='https:'||!u.hostname||u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.hostname==='localhost'||u.hostname==='127.0.0.1')throw new Error('Production requires a real HTTPS API origin without path, credentials or query.');
}
const rel=relative(source,output);
if(!rel.startsWith('..')&&!isAbsolute(rel))throw new Error('Release output must be outside the source tree.');
if(basename(output).toLowerCase()!=='jpano-portfolio')throw new Error('Invalid output folder.');
const marker=join(output,'.jpano-generated');
try {
  const found=await readdir(output);
  if(found.length && !found.includes('.jpano-generated'))throw new Error('Refusing to overwrite an unrelated existing folder: '+output);
}catch(e){if(e.code!=='ENOENT')throw e;}
// Mark this directory as managed before building. A failed build remains
// incomplete, but a second compilation can safely resume it.
await mkdir(output,{recursive:true});
await writeFile(marker,'Managed JPano compiled release folder.\n',{mode:0o600});
await writeFile(join(output,'BUILD_INCOMPLETE'),'Compilation did not finish. Do not deploy.\n',{mode:0o600});
const node=process.execPath;
function run(command,args,options={}){
  const result=spawnSync(command,args,{cwd:options.cwd||source,env:options.env||process.env,stdio:'inherit',shell:false});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error(`${command} failed (${result.status ?? 'unknown'}).`);
}
console.log('[JPano] Validating frontend source…');
run(node,['client/scripts/tools/check.mjs']);
run(node,['--test','client/scripts/tests/structure.test.mjs','client/scripts/tests/final-production.test.mjs','client/scripts/tests/release-final.test.mjs']);
console.log('[JPano] Building static frontend…');
const buildEnv={...process.env};
if(mode==='production' && deployOrigin){
  buildEnv.API_ORIGIN=deployOrigin;
  buildEnv.PUBLIC_API_BASE_URL=deployOrigin;
  buildEnv.PUBLIC_SNAPSHOT_URL=`${deployOrigin}/api/public/snapshot`;
}
run(node,['client/htmls/vercel/build.mjs'],{env:buildEnv});
console.log('[JPano] Checking browser output for private credentials…');
run(node,['client/scripts/tools/verify-client-secrets.mjs']);
console.log('[JPano] Cross-compiling Go…');
const targets=[
  ['windows','amd64','system/windows/jpano-portfolio.exe'],
  ['linux','amd64','system/linux/jpano-portfolio'],
  ['darwin','amd64','system/macos/jpano-portfolio-amd64'],
  ['darwin','arm64','system/macos/jpano-portfolio-arm64']
];
for(const [os,arch,relativeFile] of targets){
  const filepath=join(output,...relativeFile.split('/'));
  await mkdir(dirname(filepath),{recursive:true});
  console.log(`[JPano] ${os}/${arch}`);
  run('go',['build','-trimpath','-ldflags=-s -w','-o',filepath,'.'],{
    cwd:join(source,'server'),env:{...process.env,GOOS:os,GOARCH:arch,CGO_ENABLED:'0'}
  });
  if(os!=='windows')await chmod(filepath,0o755).catch(()=>{});
}
// The private copy is output only in the explicit release folder, not under
// the source checkout or client/static files.
run(node,['client/scripts/tools/split-env.mjs',join(output,'env')]);
if(mode==='production'){
  // The Go server and Vercel runtime function each read THEIR OWN deployed
  // environment at startup/request time. No API hostname is baked into HTML.
  const file=join(output,'env','client','.env');
  let value=await readFile(file,'utf8');
  const clientReplacements={
    PUBLIC_API_BASE_URL:deployOrigin,
    API_ORIGIN:deployOrigin,
    PUBLIC_SNAPSHOT_URL:deployOrigin ? `${deployOrigin}/api/public/snapshot` : '',
    FRONTEND_ORIGIN:'https://jpano.dev'
  };
  for(const [key,replacement] of Object.entries(clientReplacements)){
    value=value.replace(new RegExp('^'+key+'=.*$','m'),`${key}=${replacement}`);
  }
  await writeFile(file,value,{mode:0o600});
  const backend=join(output,'env','server','.env');
  let server=await readFile(backend,'utf8');
  const replacements={
    API_ORIGIN:deployOrigin,FRONTEND_ORIGIN:'https://jpano.dev',
    CORS_ALLOWED_ORIGINS:'https://jpano.dev',BACKEND_BIND:'0.0.0.0',
    TRUST_PROXY:'true',PUBLIC_API_BASE_URL:deployOrigin,
    PUBLIC_SNAPSHOT_URL:deployOrigin ? `${deployOrigin}/api/public/snapshot` : ''
  };
  for(const [key,replacement] of Object.entries(replacements)){
    server=server.replace(new RegExp('^'+key+'=.*$','m'),`${key}=${replacement}`);
  }
  await writeFile(backend,server,{mode:0o600});
}
for(const relativeFile of ['client','database'])await rm(join(output,relativeFile),{recursive:true,force:true});
await mkdir(join(output,'client','assets','data'),{recursive:true});
await mkdir(join(output,'database'),{recursive:true});
await mkdir(join(output,'server'),{recursive:true});
await cp(join(source,'client/htmls/vercel/dist'),join(output,'client','dist'),{recursive:true});
if(mode==='production'){
  // Production Vercel builds read PUBLIC_API_BASE_URL at REQUEST TIME.
  // This deliberately removes the old compiled config.js that would make
  // moving the backend require a frontend rebuild.
  const deployed=join(output,'client','dist');
  await rm(join(deployed,'config.js'),{force:true});
  await mkdir(join(deployed,'api'),{recursive:true});
  await cp(join(source,'client/htmls/vercel/api/runtime-config.js'),join(deployed,'api','runtime-config.js'));
  const vercel=JSON.parse(await readFile(join(source,'client/htmls/vercel/vercel.json'),'utf8'));
  delete vercel.buildCommand;
  delete vercel.outputDirectory;
  await writeFile(join(deployed,'vercel.json'),JSON.stringify(vercel,null,2)+'\n');
  await writeFile(join(deployed,'package.json'),JSON.stringify({name:'jpano-portfolio-runtime',private:true,type:'module'},null,2)+'\n');
}

await cp(join(source,'client/assets/data/public-snapshot.json'),join(output,'client/assets/data/public-snapshot.json'));
await cp(join(source,'database/schema.sql'),join(output,'database/schema.sql'));
await writeFile(join(output,'DEPLOYMENT_README.md'), `# JPano compiled distribution — runtime API configuration

Mode: **${mode}**
${mode==='production' ? `Initial public API origin: ${deployOrigin || 'NOT SET — configure PUBLIC_API_BASE_URL in Vercel and API_ORIGIN in Render before going live.'}` : 'LOCAL MODE — generated static config.js can be refreshed from .env without recompilation.'}

## Vercel (production)
Deploy ONLY \`client/dist/\` with the Vercel project root pointing to that folder.
It contains \`api/runtime-config.js\` and \`vercel.json\`. \`/config.js\` is a no-store Vercel Function response, NOT a build-time file.
Add \`PUBLIC_API_BASE_URL=https://YOUR-BACKEND\` in **Vercel Environment Variables**. Optionally set \`PUBLIC_SUPABASE_URL\` and \`PUBLIC_SUPABASE_PUBLISHABLE_KEY\` (public values only).
Changing the hosted API URL needs NO frontend recompilation. Apply the new hosting environment settings to a deployment (Vercel may require redeployment for new env values); then refresh the website.
Do not send \`env/server/.env\` or any root private .env to Vercel/GitHub.

## Go backend / Render
Set \`API_ORIGIN=https://YOUR-BACKEND\`, \`FRONTEND_ORIGIN=https://jpano.dev\`, \`CORS_ALLOWED_ORIGINS=https://jpano.dev\`, and \`BACKEND_BIND=0.0.0.0\` in **Render Environment** (or \`env/server/.env\` for your own host). Go reads these at process startup; restart when you change them. A hosting provider's PORT overrides BACKEND_PORT.
The compiled Go binaries are in \`system/\` for supported operating systems. Keep the reviewed database schema and public assets with the backend.

## Non-Vercel static hosting
Static web hosts cannot read .env files at request time. Generate only a NEW public \`config.js\` from the updated root .env using \`node client/scripts/tools/update-runtime-config.mjs <dist-directory> <env-file>\` in the source folder; redeploy that file only. No JavaScript bundle recompilation is necessary.

## PayMongo
PayMongo sends a signed HTTPS webhook to the Go backend, which commits and broadcasts verified project balances over the authenticated WebSocket. Browser checks are one-shot recovery only if a webhook is delayed. The Go background reconciler also repairs missed events. Never infer paid status from browser redirects. Localhost is not reachable by PayMongo webhooks.

## Safety
This distribution may contain real secrets in \`env/server/.env\` if your original .env contained them. Keep the distribution private. The root .env is NOT duplicated in the release. Complete \`go test ./...\` with Go 1.25+ and run one real webhook + reconnect smoke test before production.
`);
await rm(join(output,'BUILD_INCOMPLETE'),{force:true});
console.log(`[JPano] Release ready: ${output}`);
console.log('[JPano] Never push env/server/.env to Vercel or a public repository.');
