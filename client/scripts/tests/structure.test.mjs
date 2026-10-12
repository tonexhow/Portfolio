import test from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const client=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const root=resolve(client,"..");
const exists=path=>stat(path).then(s=>s.isFile()).catch(()=>false);
const scan=async(dir)=>{
  const result=[];
  for(const item of await readdir(dir,{withFileTypes:true})){
    const path=join(dir,item.name);
    if(item.isDirectory())result.push(...await scan(path));
    else if(item.isFile())result.push(path);
  }
  return result;
};

test("source root contains exactly the application and requested Windows launchers",async()=>{
  // A normal checkout may also include local .git or editor metadata; those
  // are not application folders and aren't shipped in the source ZIP.
  const metadata=new Set([".git",".gitignore",".vscode",".idea",".DS_Store","Thumbs.db","Desktop.ini"]);
  const entries=(await readdir(root)).filter(name=>!metadata.has(name)).sort();
  const required=[".env.example","api","clean.bat","client","compile.bat","database","docs","run.bat","server","vercel.json"];
  for(const entry of required)assert.ok(entries.includes(entry),`Missing ${entry}`);
  const allowed=new Set([...required,".env","JPano-Release","README.md",".bk"]);
  for(const entry of entries)assert.ok(allowed.has(entry),`Unexpected source root item: ${entry}`);
  for(const dir of ["client","server","database"]){
    for(const item of await scan(join(root,dir))){
      assert.doesNotMatch(item,/\.bat$/i, "launcher must remain at root, not inside application folders");
    }
  }
});

test("every local HTML script and stylesheet references a real source file",async()=>{
  const html=await readdir(join(client,"htmls"));
  let verified=0;
  for(const page of html.filter(x=>x.endsWith(".html"))){
    const text=await readFile(join(client,"htmls",page),"utf8");
    const urls=[...text.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="(\/[^\"]+)"/g)].map(x=>x[1]);
    for(const url of urls){
      const path=url.split(/[?#]/,1)[0];
      if(path==="/config.js")continue; // generated at build time, fallback at source
      assert.equal(await exists(join(client,path.slice(1))),true,`${page} -> ${url}`);
      verified++;
    }
  }
  assert.ok(verified>20);
});

test("frontend module imports resolve after regrouping",async()=>{
  const files=(await scan(join(client,"scripts"))).filter(x=>x.endsWith(".js"));
  let count=0;
  for(const file of files){
    const js=await readFile(file,"utf8");
    for(const [,relative] of js.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:[^\n]*?\s+from\s+)?["'](\.{1,2}\/[^"']+)["']/g)){
      const name=relative.split(/[?#]/,1)[0];
      assert.equal(await exists(resolve(dirname(file),name)),true,`${file} -> ${relative}`);
      count++;
    }
  }
  assert.ok(count>10);
});
