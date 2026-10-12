import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const source=path=>readFile(join(root,path),'utf8');

test('footer has a focusable business-card trigger and remains readable on mobile',async()=>{
  const ui=await source('client/scripts/ui/ui.js');
  const css=await source('client/styles/style.css');
  assert.match(ui,/data-business-card-open/);
  assert.match(ui,/aria-haspopup="dialog"/);
  assert.match(ui,/footer-copyright/);
  assert.match(css,/\.site-footer \.footer-center>p\.footer-copyright\{display:flex/);
  assert.match(css,/\.business-card-dialog::backdrop/);
});
test('both supplied card images are included and downloadable without Go',async()=>{
  for(const side of ['front','back']){
    const image=await readFile(join(root,`client/assets/cards/${side}-bc.png`));
    assert.equal(image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.ok(image.length>100000);
  }
  const script=await source('client/scripts/ui/business-card.js');
  assert.match(script,/front-bc\.png/);assert.match(script,/back-bc\.png/);
  assert.match(script,/download="Jhon-Anthony-Pano-Business-Card-Front\.png"/);
  assert.match(script,/download="Jhon-Anthony-Pano-Business-Card-Back\.png"/);
  assert.match(script,/\.showModal\(\)/);
  assert.match(script,/aria-pressed/);
  assert.match(await source('client/scripts/script.js'),/initBusinessCardModal\(\)/);
});
test('Windows release includes GUI backend, verified stop.exe and persistent runtime log',async()=>{
  const build=await source('client/scripts/tools/compile-release.mjs');
  const bat=await source('compile.bat');
  assert.match(build,/-H=windowsgui/);
  assert.match(build,/system','windows','stop\.exe/);
  assert.match(build,/readUInt16LE\(offset\+24\+68\)!==2/);
  assert.match(bat,/windows\\stop\.exe/);
  assert.match(await source('server/main.go'),/winruntime\.WatchStop\(\)/);
  assert.match(await source('server/internal/application/app.go'),/externalStop <-chan struct\{\}/);
  assert.match(await source('server/internal/winruntime/logging.go'),/logs\.txt/);
  assert.match(await source('server/internal/winruntime/control_windows.go'),/QueryFullProcessImageNameW/);
  assert.match(await source('server/tools/stop/main.go'),/StopVerifiedPID/);
});
test('documentation no longer pollutes public HTML and runtime secrets remain gitignored',async()=>{
  assert.ok((await stat(join(root,'docs/README.md'))).isFile());
  const htmls=await source('client/htmls/index.html');
  assert.match(htmls,/site-footer/);
  const ignore=await source('.gitignore');
  for(const name of ['logs.txt','JPano-Release/','server/.migration-backup/'])assert.ok(ignore.includes(name));
});
