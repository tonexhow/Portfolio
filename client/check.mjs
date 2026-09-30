import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root=dirname(fileURLToPath(import.meta.url));let count=0;
async function scan(dir){for(const item of await readdir(dir,{withFileTypes:true})){if(["dist","node_modules"].includes(item.name))continue;const path=join(dir,item.name);if(item.isDirectory())await scan(path);else if(/\.(m?js)$/.test(item.name)){const result=spawnSync(process.execPath,["--check",path],{encoding:"utf8"});if(result.status!==0)throw new Error(result.stderr);count++;}}}
await scan(root);
for(const page of ["index.html","admin.html","access.html","access-verify.html","access-grant.html","privacy.html","terms.html","data-deletion.html"]){const html=await readFile(join(root,page),"utf8");if(/data-theme-option="auto"|host\.json|personal_information\.json/.test(html))throw new Error(`Obsolete content in ${page}`);}
console.log(`PASS: ${count} JavaScript files parse. Page migration checks passed.`);
