// Dependency-free static build. Only the public API origin is emitted; secrets are never written to client output.
import { cp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { mergePublishedMedia } from "../../scripts/tools/snapshot-helpers.mjs";
import { renderPublicConfig, publicClientConfig } from "./api/runtime-config.js";
const deployRoot = dirname(fileURLToPath(import.meta.url));
const root = resolve(deployRoot, "../..");
const out = join(deployRoot, "dist");
// Local build: process environment -> root .env -> generated env/client/.env.
// Vercel supplies process environment directly; never emit server credentials.
async function readEnvironment(path) {
  let content;
  try {content=await readFile(path,"utf8");}
  catch(error){if(error.code==="ENOENT")return {};throw error;}
  const entries={};
  for(const raw of content.replace(/^\uFEFF/,"").split(/\r?\n/)){
    const line=raw.trim();if(!line||line.startsWith("#"))continue;
    const m=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if(!m)continue;let value=m[2].trim();
    if(value.length>=2&&((value[0]==='"'&&value.at(-1)==='"')||(value[0]==="'"&&value.at(-1)==="'")))value=value.slice(1,-1);
    entries[m[1]]=value;
  }
  return entries;
}
const projectRoot=join(root,"..");
const mainEnvironment=await readEnvironment(join(projectRoot,".env"));
const innerEnvironment=await readEnvironment(join(projectRoot,"env","client",".env"));
const getConfig=key=>process.env[key]??mainEnvironment[key]??innerEnvironment[key]??"";

function origin(value) {
  const url = new URL(value);
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("API_ORIGIN must be a complete HTTP(S) origin without a path or credentials.");
  if (url.protocol !== "https:" && !["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw new Error("Use HTTPS for the public API.");
  return url.origin;
}
// Vercel may set PUBLIC_API_BASE_URL without setting API_ORIGIN. Both process
// variables outrank the root/local .env so a local API_ORIGIN cannot shadow the
// hosted backend URL. The root .env still outranks the optional inner fallback.
const apiBaseURL = origin(
  process.env.PUBLIC_API_BASE_URL || process.env.API_ORIGIN ||
  mainEnvironment.PUBLIC_API_BASE_URL || mainEnvironment.API_ORIGIN ||
  innerEnvironment.PUBLIC_API_BASE_URL || innerEnvironment.API_ORIGIN ||
  "http://127.0.0.1:48000"
);
const supabaseURL = String(getConfig("PUBLIC_SUPABASE_URL") || "").trim();
const supabasePublishableKey = String(getConfig("PUBLIC_SUPABASE_PUBLISHABLE_KEY") || "").trim();
if (supabaseURL && (!supabasePublishableKey || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseURL))) {
  throw new Error("PUBLIC_SUPABASE_URL must be the HTTPS Supabase project origin; a public publishable key is required.");
}
if (supabasePublishableKey && !supabaseURL) {
  throw new Error("PUBLIC_SUPABASE_URL is required when configuring a publishable key.");
}
function isPublicBrowserKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return true;
  if (!/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    // Legacy Supabase keys are JWTs: only the anon role may enter a browser.
    const payload = JSON.parse(Buffer.from(value.split(".")[1], "base64url").toString("utf8"));
    return payload.role === "anon";
  } catch { return false; }
}
if (supabasePublishableKey && !isPublicBrowserKey(supabasePublishableKey)) {
  throw new Error("Use only the Supabase publishable/anon key; a secret/service_role key is forbidden in client assets.");
}
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ["index.html","admin.html","access.html","access-verify.html","access-grant.html","privacy.html","terms.html","data-deletion.html","styles","assets","service-worker.js"]) await cp(join(root, item.endsWith(".html") ? "htmls" : item === "service-worker.js" ? "htmls/vercel" : ".",item),join(out,item),{recursive:true});
// Only browser-executable scripts are shipped; exclude tests and build tools.
await mkdir(join(out,"scripts"),{recursive:true});
for(const name of ["chat","core","pages","ui","script.js"]){
  await cp(join(root,"scripts",name),join(out,"scripts",name),{recursive:true});
}
// Plain local static servers do not read Vercel rewrites. Materialize the same
// clean routes as directories so /admin, /access/verify and email grant links
// work when `npx serve dist -l 3000` is used on Windows.
for (const [route, page] of [
  ["admin", "admin.html"], ["access", "access.html"],
  ["access/verify", "access-verify.html"],
  ["access/grant", "access-grant.html"],
  ["privacy", "privacy.html"], ["terms", "terms.html"],
  ["data-deletion", "data-deletion.html"]
]) {
  const directory = join(out, ...route.split("/"));
  await mkdir(directory, { recursive: true });
  await cp(join(root, "htmls", page), join(directory, "index.html"));
}
await writeFile(join(out,"config.js"),renderPublicConfig(publicClientConfig({
  PUBLIC_API_BASE_URL:apiBaseURL,
  PUBLIC_SUPABASE_URL:supabaseURL,
  PUBLIC_SUPABASE_PUBLISHABLE_KEY:supabasePublishableKey
})));
const snapshotSource = getConfig("PUBLIC_SNAPSHOT_URL").trim() || `${apiBaseURL}/api/public/snapshot`;
let extractedGoSnapshot = false;
if (snapshotSource) {
  try {
    const url = new URL(snapshotSource);
    if (url.origin !== apiBaseURL || url.pathname !== "/api/public/snapshot" || url.search || url.hash) throw new Error("PUBLIC_SNAPSHOT_URL must match API_ORIGIN/api/public/snapshot.");
    const response = await fetch(url,{signal:AbortSignal.timeout(15000),redirect:"error"});
    if (!response.ok) throw new Error(`Public snapshot returned HTTP ${response.status}.`);
    const text=await response.text(); if(Buffer.byteLength(text)>5*1024*1024)throw new Error("Snapshot is too large.");
    const data=JSON.parse(text);
    if(data.schema_version!==1 || !data.information || ![data.projects,data.certificates,data.feedback].every(Array.isArray))throw new Error("Invalid public snapshot.");
    const extensions={"image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif"};
    const mediaCache=new Map();
    async function materialize(value) {
      if(typeof value!=="string" || !value.startsWith("/api/public/"))return value;
      if(mediaCache.has(value))return mediaCache.get(value);
      const url=new URL(value,apiBaseURL);
      if(url.origin!==apiBaseURL || !/^\/api\/public\/(certificates\/\d+\/(image|download)|project-media\/[A-Za-z0-9_-]+)$/.test(url.pathname))return "";
      const res=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:"error"});
      if(!res.ok)throw new Error(`Published media returned HTTP ${res.status}.`);
      const ext=extensions[(res.headers.get("content-type")||"").split(";")[0]];if(!ext)throw new Error("Unsupported published image.");
      const bytes=Buffer.from(await res.arrayBuffer());if(bytes.length>8*1024*1024)throw new Error("Published image exceeds export limit.");
      const name=`published-${createHash("sha256").update(bytes).digest("hex").slice(0,24)}.${ext}`;
      await writeFile(join(out,"assets","published",name),bytes);
      const path=`/assets/published/${name}`;mediaCache.set(value,path);return path;
    }
    for(const certificate of data.certificates){certificate.image_url=await materialize(certificate.image_url);certificate.download_url=certificate.image_url;}
    for(const project of data.projects){project.icon=await materialize(project.icon);project.images=await Promise.all((project.images||[]).map(materialize));project.status="unknown";project.checked_at=null;}
    for(const feedback of data.feedback)feedback.avatar_url="";
    data.profiles ||= {items:[],rotation_seconds:60};
    data.profiles.items=await Promise.all((data.profiles.items||[]).map(materialize));
    data.information.profile_images=data.profiles.items;
    await writeFile(join(out,"assets","data","public-snapshot.json"),JSON.stringify(data,null,2)+"\n");
    extractedGoSnapshot = true;
    console.log("Published portfolio snapshot and media exported into this deployment.");
  } catch(error) {
    // A stopped personal server must not prevent deployment of the existing public site.
    console.warn(`Live snapshot unavailable: ${error.message} Using the bundled public snapshot.`);
  }
}
// When Go is down at build time, prefer LIVE Supabase published data over the
// previously bundled static snapshot. Storage-hosted media works without Go;
// known legacy image blobs retain their existing static fallback by record ID.
if (!extractedGoSnapshot && supabaseURL && supabasePublishableKey) {
  try {
    const response=await fetch(`${supabaseURL}/rest/v1/rpc/jpano_public_snapshot`,{
      method:"POST",headers:{apikey:supabasePublishableKey,"Content-Type":"application/json"},
      body:"{}",signal:AbortSignal.timeout(11000)
    });
    if(!response.ok)throw new Error(`Supabase public snapshot HTTP ${response.status}; review the optional public RPC migration.`);
    const text=await response.text();
    if(Buffer.byteLength(text)>2*1024*1024)throw new Error("Public snapshot exceeds size limit.");
    const live=JSON.parse(text);
    const old=JSON.parse(await readFile(join(out,"assets","data","public-snapshot.json"),"utf8"));
    const result=mergePublishedMedia(live,old);
    // Existing older caches can have a higher revision only if a project was
    // switched or reinitialized: never overwrite a newer local snapshot.
    if(Number(live.revision)<Number(old.revision)) throw new Error("Live revision is older than the fallback snapshot.");
    await writeFile(join(out,"assets","data","public-snapshot.json"),JSON.stringify(result.snapshot,null,2)+"\n");
    for(const warning of result.warnings)console.warn(warning);
    console.log("Published content refreshed directly from Supabase with Go offline.");
  }catch(error){console.warn(`Supabase build-time fallback unavailable: ${error.message}. Keeping bundled published snapshot.`)}
}

// Published media can legitimately be empty in a fresh checkout. An empty
// directory is not a build failure and needs no warning during pruning.
await mkdir(join(out,'assets','published'),{recursive:true});
// Privacy safeguard: a removed/unpublished certificate should not remain as a
// separately addressable static file on the *next successful deployment*.
// Keep only media referenced by the actual bundled public snapshot. This does
// not revoke already-deployed CDN caches; redeploy and purge if necessary.
try {
  const bundled=JSON.parse(await readFile(join(out,"assets","data","public-snapshot.json"),"utf8"));
  const used=new Set();
  const collect=value=>{
    if(typeof value === "string"){
      const match=value.match(/^\/assets\/published\/([A-Za-z0-9._-]+)(?:[?#].*)?$/);
      if(match)used.add(match[1]);
    }else if(Array.isArray(value)) value.forEach(collect);
    else if(value&&typeof value==="object") Object.values(value).forEach(collect);
  };
  collect(bundled);
  let pruned=0;
  for(const entry of await readdir(join(out,"assets","published"),{withFileTypes:true})){
    // Ignore subdirectories or unexpected filenames; these are not managed
    // media. We never follow symlinks or remove anything outside build/dist.
    if(entry.isFile()&&!used.has(entry.name)&&/^(certificate-\d+|published-[0-9a-f]{24})\.(?:png|jpe?g|webp|gif)$/i.test(entry.name)){
      await rm(join(out,"assets","published",entry.name));pruned++;
    }
  }
  if(pruned) console.log(`Removed ${pruned} unreferenced published media files from the deployment.`);
}catch(error){console.warn(`Could not prune published deployment media: ${error.message}`)}
console.log(`Static frontend built in client/htmls/vercel/dist. API origin: ${apiBaseURL}`);

// When deployed from this source directory on Vercel, do not ship a stale
// build-time config.js that might shadow the runtime serverless function.
if (process.env.VERCEL === "1") {
  await rm(join(out,"config.js"), {force:true});
  console.log("Vercel runtime config enabled: /config.js -> /api/runtime-config (no-store).");
}
