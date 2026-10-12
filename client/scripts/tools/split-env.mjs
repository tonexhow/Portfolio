// Split the root configuration into separately scoped local/release files.
// Private server credentials NEVER enter env/client/.env or client/dist.
// Usage: node client/scripts/tools/split-env.mjs [output-directory]
import {readFile,mkdir,writeFile,chmod} from "node:fs/promises";
import {join,resolve,dirname,relative,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
const project=resolve(dirname(fileURLToPath(import.meta.url)),"../../..");
const source=join(project,".env");
// Require an explicit release destination: the source root must not gain env/.
if (!process.argv[2]) throw new Error("Provide the compiled distribution's env directory: node client/scripts/tools/split-env.mjs <release-dir>/env");
const output=resolve(process.argv[2]);
const relativeOutput = relative(project, output);
if (!relativeOutput.startsWith("..") && !isAbsolute(relativeOutput)) {
  throw new Error("The environment splitter writes only to a separate distribution directory, not inside the source tree.");
}
const content=await readFile(source,"utf8");
const pairs=new Map();
for(const raw of content.replace(/^\uFEFF/,"").split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith("#"))continue;
  const match=line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
  if(!match)continue;
  if(/[\r\n]/.test(match[2]))throw new Error("Invalid line in environment file");
  pairs.set(match[1],match[2].trim());
}
const clientKeys=new Set([
  "API_ORIGIN","PUBLIC_API_BASE_URL","PUBLIC_SNAPSHOT_URL","PUBLIC_SUPABASE_URL",
  "PUBLIC_SUPABASE_PUBLISHABLE_KEY","FRONTEND_ORIGIN","FRONTEND_PORT"
]);
function isPublishableKey(raw){
  let value=String(raw||"").trim();
  if(value.length>=2&&((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))))value=value.slice(1,-1);
  if(!value)return true;
  if(/^sb_publishable_[A-Za-z0-9_-]+$/.test(value))return true;
  if(!/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))return false;
  try {return JSON.parse(Buffer.from(value.split(".")[1],"base64url").toString("utf8")).role==="anon";}catch{return false}
}
if(!isPublishableKey(pairs.get("PUBLIC_SUPABASE_PUBLISHABLE_KEY"))) {
  throw new Error("Refusing to export a non-publishable Supabase key to client configuration.");
}
const client=["# PUBLIC CLIENT CONFIG - contains NO private credentials"];
const server=["# PRIVATE SERVER CONFIG - restrict file access"];
for(const [key,value] of pairs){
  if(clientKeys.has(key))client.push(`${key}=${value}`);
  // Keep all other keys on the server, including API_ORIGIN and ports.
  server.push(`${key}=${value}`);
}
const write=async(rel,lines)=>{
  const dest=join(output,rel,".env");await mkdir(dirname(dest),{recursive:true});
  await writeFile(dest,lines.join("\n")+"\n",{mode:0o600});
  await chmod(dest,0o600).catch(()=>{});
};
await write("client",client);await write("server",server);
console.log("Environment split complete: env/client/.env (public), env/server/.env (private). No credential values printed.");
