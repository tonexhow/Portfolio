import test from 'node:test';
import assert from 'node:assert/strict';
import {renderChatMarkdown,createSandboxDocument} from '../chat/chat-markdown.js';
import {qrSVG} from '../chat/qr-code.js';

const previewLangs=['html','markup','frontend','client','page','webpage'];
for(const lang of previewLangs){
  test(`${lang} code blocks get explicit preview but source stays escaped`,()=>{
    const out=renderChatMarkdown(`\`\`\`${lang}\n<style>body{color:red}</style><script>window.x=2</script>\n\`\`\``);
    assert.match(out,/data-chat-preview/);
    assert.match(out,/&lt;style&gt;/);
    assert.match(out,/&lt;script&gt;/);
    assert.doesNotMatch(out,/<script>/);
  });
}
test('no executable preview is added to arbitrary JS or plain text',()=>{
  assert.doesNotMatch(renderChatMarkdown('```javascript\nalert(1)\n```'),/data-chat-preview/);
  assert.doesNotMatch(renderChatMarkdown('<script>alert(1)</script>'),/<script>/);
});
test('sandbox includes a restrictive CSP before user code',()=>{
  for(const raw of ['<html><script>alert(1)</script></html>','<html><head><script>alert(1)</script></head><body></body></html>','<style>body{color:red}</style><script>alert(1)</script>']){
    const html=createSandboxDocument(raw);
    assert.ok(html.indexOf('Content-Security-Policy')>=0);
    assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('<script>'));
    assert.match(html,/connect-src 'none'/);
    assert.match(html,/form-action 'none'/);
  }
});
test('Markdown reference links, images, footnotes, and task checkboxes',()=>{
  const result=renderChatMarkdown('[My site][portfolio]\n\n[portfolio]: https://jpano.dev\n\n![profile](https://jpano.dev/favicon.ico)\n\nDescription[^note]\n\n[^note]: Footnote text\n\n- [x] Done\n  - [ ] Pending');
  assert.match(result,/href="https:\/\/jpano\.dev\/"/);
  assert.match(result,/chat-md-image/);
  assert.match(result,/chat-footnotes/);
  assert.match(result,/disabled checked/);
  assert.match(result,/Pending/);
});
test('links with script/data/vbscript protocols are never active',()=>{
  const source='[run](javascript:alert) [data](data:text/html,hi) [vbs](vbscript:hello) <script>alert(1)</script>';
  const html=renderChatMarkdown(source);
  assert.doesNotMatch(html,/href="(?:javascript|data|vbscript):/i);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;/);
});
test('PayMongo hosted checkout URL creates a QR SVG without external assets',()=>{
  const svg=qrSVG('https://checkout.paymongo.com/cs_example#token');
  assert.match(svg,/<svg/);
  assert.match(svg,/QR code linking to PayMongo/);
  assert.match(svg,/<path/);
  assert.throws(()=>qrSVG('https://example.com/checkout'),/PayMongo/);
});
