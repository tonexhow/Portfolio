// Dependency-free static build. Only the public API origin is emitted; secrets are never written to client output.
import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = dirname(fileURLToPath(import.meta.url));
const out = join(root, "dist");
function origin(value) {
  const url = new URL(value);
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("API_ORIGIN must be a complete HTTP(S) origin without a path or credentials.");
  if (url.protocol !== "https:" && !["localhost","127.0.0.1","[::1]"].includes(url.hostname)) throw new Error("Use HTTPS for the public API.");
  return url.origin;
}
const apiBaseURL = origin(process.env.API_ORIGIN || process.env.PUBLIC_API_BASE_URL || "http://127.0.0.1:48000");
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const item of ["index.html","admin.html","access.html","access-verify.html","access-grant.html","privacy.html","terms.html","data-deletion.html","styles","scripts","assets","service-worker.js"]) await cp(join(root,item),join(out,item),{recursive:true});
await writeFile(join(out,"config.js"), `window.APP_CONFIG = Object.freeze(${JSON.stringify({apiBaseURL,statusIntervalMs:30000,requestTimeoutMs:7000})});\n`);
const snapshotSource = process.env.PUBLIC_SNAPSHOT_URL?.trim() || `${apiBaseURL}/api/public/snapshot`;
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
    console.log("Published portfolio snapshot and media exported into this deployment.");
  } catch(error) {
    // A stopped personal server must not prevent deployment of the existing public site.
    console.warn(`Live snapshot unavailable: ${error.message} Using the bundled public snapshot.`);
  }
}
console.log(`Static frontend built in client/dist. API origin: ${apiBaseURL}`);
