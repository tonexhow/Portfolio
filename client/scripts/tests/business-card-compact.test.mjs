import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const read=path=>readFile(resolve(root,path),'utf8');

test('business card dialog is compact and preview-first, without redundant intro',async()=>{
  const js=await read('client/scripts/ui/business-card.js');
  const css=await read('client/styles/style.css');
  assert.doesNotMatch(js,/A personal introduction\./);
  assert.doesNotMatch(js,/class="business-card-lead"/);
  assert.match(js,/<button class="business-card-stage" type="button" data-card-flip/);
  assert.match(js,/class="business-card-actions"/);
  assert.match(css,/\.business-card-dialog\{[^}]*max-height:calc\(100dvh - 28px\)/);
  assert.match(css,/@media\(max-width:640px\)/);
});

test('both sides, navigation controls and downloads remain accessible',async()=>{
  const js=await read('client/scripts/ui/business-card.js');
  assert.match(js,/data-card-side="front" aria-pressed="true"/);
  assert.match(js,/data-card-side="back" aria-pressed="false"/);
  assert.match(js,/aria-live="polite"/);
  assert.match(js,/data-download-card="front"/);
  assert.match(js,/data-download-card="back"/);
  assert.match(js,/restoreFocus\?\.focus/);
  assert.match(js,/event\.target\.closest\?\.\("\[data-business-card-open\]"\)/);
});

test('updated JS and CSS assets are cache-busted for deployment',async()=>{
  const html=await read('client/htmls/index.html');
  const entry=await read('client/scripts/script.js');
  assert.match(html,/style\.css\?v=45/);
  assert.match(html,/script\.js\?v=46/);
  assert.match(entry,/ui\/business-card\.js\?v=2/);
});
