import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const verify=join(root,'client/scripts/tools/verify-client-secrets.mjs');
const split=join(root,'client/scripts/tools/split-env.mjs');
const fakeGoogle='FAKE_GOOGLE_SECRET_FOR_TEST_ONLY_12345';
const fakePayment='FAKE_PAYMENT_SECRET_FOR_TEST_ONLY_54321';

test('release secret scanner permits real private .env credentials but never client leaks',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'jpano-secret-test-'));
  try {
    const web=join(temp,'dist'),source=join(temp,'secrets.env');
    await mkdir(web);
    await writeFile(source,`GOOGLE_CLIENT_SECRET=${fakeGoogle}\nPAYMONGO_SECRET=${fakePayment}\n`);
    await writeFile(join(web,'config.js'),'window.APP_CONFIG={apiBaseURL:"https://backend.example"};');
    let run=spawnSync(process.execPath,[verify,web,source],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    await writeFile(join(web,'accidental.js'),`const unsafe=${JSON.stringify(fakeGoogle)};`);
    run=spawnSync(process.execPath,[verify,web,source],{encoding:'utf8'});
    assert.equal(run.status,1);
    assert.match(run.stderr,/SECRET_EXPOSED.*GOOGLE_CLIENT_SECRET/);
    assert.doesNotMatch(run.stdout+run.stderr,new RegExp(fakeGoogle));
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('configured server OAuth secrets stay out of generated client environment',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'jpano-env-test-'));
  try {
    const source=join(temp,'source'),out=join(temp,'release','env');
    const tool=join(source,'client/scripts/tools/split-env.mjs');
    await mkdir(dirname(tool),{recursive:true});
    await copyFile(split,tool);
    await writeFile(join(source,'.env'),`API_ORIGIN=https://backend.example\nPUBLIC_API_BASE_URL=https://backend.example\nGOOGLE_CLIENT_ID=browser-visible-id\nGOOGLE_CLIENT_SECRET=${fakeGoogle}\nPAYMONGO_SECRET=${fakePayment}\nPAYMONGO_ALLOW_LIVE=false\n`);
    const run=spawnSync(process.execPath,[tool,out],{encoding:'utf8'});
    assert.equal(run.status,0,run.stderr);
    const client=await readFile(join(out,'client','.env'),'utf8');
    const server=await readFile(join(out,'server','.env'),'utf8');
    assert.match(client,/PUBLIC_API_BASE_URL=https:\/\/backend\.example/);
    assert.doesNotMatch(client,/GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|PAYMONGO_SECRET|browser-visible-id|FAKE_/);
    assert.match(server,/GOOGLE_CLIENT_SECRET=/);
    assert.match(server,/PAYMONGO_SECRET=/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});
