// Configuration-only audit: prints public OAuth callback endpoints and status
// flags. Deliberately never echoes credentials, URLs with embedded passwords,
// access tokens, or server environment values other than public origins.
// Usage: node client/scripts/tools/audit-config.mjs [https://your-api-origin]
import {readFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const cfg={};
const text=await readFile(join(root,'.env'),'utf8');
for(const line of text.split(/\r?\n/)){
 const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
 if(!match)continue;
 const raw=match[2].trim();
 cfg[match[1]]=raw.replace(/^(['"])(.*)\1$/,'$2');
}
const read=key=>process.env[key] || cfg[key] || '';
const override=process.argv[2]||'';
const origin=override||read('API_ORIGIN')||'http://127.0.0.1:48000';
function validOrigin(value){
 try {const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash&&!!u.host;}
 catch{return false}
}
if(!validOrigin(origin)) {console.error('ERROR: API_ORIGIN must be a valid HTTP(S) origin with no credentials/path.');process.exitCode=1;}
else {
 console.log('JPano OAuth callback configuration (backend-owned):');
 for(const provider of ['google','github','facebook']){
  const keys=provider==='google'?['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET']:provider==='github'?['GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET']:['FACEBOOK_CLIENT_ID','FACEBOOK_CLIENT_SECRET'];
  console.log(`- ${provider}: ${origin}/auth/feedback/${provider}/callback [${keys.every(read)?'configured':'not configured'}]`);
 }
 console.log(`- Google contact form uses the SAME /auth/feedback/google/callback`);
 console.log(`- API health: ${origin}/api/health`);
 console.log(`- PayMongo webhook: ${origin}/api/paymongo/webhook`);
 if(origin.startsWith('http://')&&!origin.startsWith('http://127.0.0.1')&&!origin.startsWith('http://localhost'))console.warn('WARNING: HTTPS is required for production callbacks.');
 if(override)console.log('NOTE: callback preview only; set this as API_ORIGIN in the running Go server.');
 const publicAPI=read('PUBLIC_API_BASE_URL');
 if(!override&&publicAPI&&publicAPI!==origin)console.warn('WARNING: PUBLIC_API_BASE_URL differs from API_ORIGIN; check that both refer to the active backend.');
 const front=read('FRONTEND_ORIGIN');
 const cors=(read('CORS_ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim());
 if(front&&!cors.includes(front))console.warn('WARNING: FRONTEND_ORIGIN missing from CORS_ALLOWED_ORIGINS.');
 if(read('FACEBOOK_APP_ID')||read('FACEBOOK_APP_SECRET'))console.warn('WARNING: legacy FACEBOOK_APP_* keys are unused; rename them to FACEBOOK_CLIENT_ID and FACEBOOK_CLIENT_SECRET.');
 const paymongoSecret=read('PAYMONGO_SECRET');
 if(paymongoSecret.startsWith('sk_live_')&&read('PAYMONGO_ALLOW_LIVE')!=='true')console.warn('WARNING: live PayMongo credentials are blocked by PAYMONGO_ALLOW_LIVE; do not enable until ready for live payments.');
 if(paymongoSecret&&!read('PAYMONGO_WEBHOOK_SECRET'))console.warn('WARNING: PAYMONGO_WEBHOOK_SECRET is empty; webhook payment confirmations cannot work.');
 console.log('Reminder: register the EXACT callback URIs in Google Cloud and GitHub OAuth app settings; source code cannot configure those dashboards.');
}
