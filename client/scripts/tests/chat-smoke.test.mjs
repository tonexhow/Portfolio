import test from "node:test";
import assert from "node:assert/strict";
import {renderChatMarkdown,formatInline} from "../chat/chat-markdown.js";
import {skillSections} from "../pages/index/career-chat.js";
globalThis.location={origin:"https://jpano.dev"};

test("CommonMark text and GFM subset render without source HTML",()=>{
  const result=renderChatMarkdown("## Section\n**bold** _italic_\n\n- [x] Done\n- [ ] Pending");
  assert.match(result,/<h2>Section<\/h2>/);
  assert.match(result,/<strong>bold<\/strong>/);
  assert.match(result,/<em>italic<\/em>/);
  assert.match(result,/class="chat-task"/);
});

test("fenced code is legible literal escaped source",()=>{
  const result=renderChatMarkdown("```text\n<script>alert(1)</script>\n```\n");
  assert.match(result,/<pre><code>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code><\/pre>/);
  assert.doesNotMatch(result,/<script>/);
});

test("unsafe protocol and event handler text do not execute",()=>{
  const html=renderChatMarkdown('[attack](javascript:alert) <img src=x onerror=alert(1)>');
  assert.doesNotMatch(html,/href="javascript:/);
  assert.doesNotMatch(html,/<img/);
  assert.match(html,/&lt;img/);
  assert.match(formatInline('[Open](https://jpano.dev)'),/rel="noopener noreferrer nofollow"/);
});

test("published skills object becomes readable categories not raw JSON",()=>{
  const result=skillSections({it:{frontend:["HTML","React"],iot:["ESP32"]},soft:["Teamwork"]});
  assert.match(result,/Frontend/);
  assert.match(result,/HTML, React/);
  assert.match(result,/IoT/);
  assert.match(result,/Soft skills/);
  assert.doesNotMatch(result,/\{"it"/);
});
