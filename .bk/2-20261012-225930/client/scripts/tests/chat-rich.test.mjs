import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChatMarkdown } from '../chat/chat-markdown.js';
import { understandUiCommand } from '../chat/tonex-actions.js';

test('deep nested lists stay nested, readable and within a normal list tree', () => {
  const html = renderChatMarkdown('- Apple\n- Banana\n  - Yellow banana\n  - Green banana\n- Mango\n\n1. First\n2. Second');
  assert.match(html, /<ul>[\s\S]*<li>[\s\S]*Banana[\s\S]*<ul>[\s\S]*Yellow banana[\s\S]*Green banana[\s\S]*<\/ul>[\s\S]*Mango[\s\S]*<\/ul>/);
  assert.match(html, /<ol start="1">[\s\S]*First[\s\S]*Second[\s\S]*<\/ol>/);
});

test('task lists render disabled checkbox with proper accessible label', () => {
  const html = renderChatMarkdown('- [x] Complete\n- [ ] Waiting');
  assert.match(html, /aria-label="Task Complete" disabled checked/);
  assert.match(html, /aria-label="Task Waiting" disabled/);
});

test('nested blockquote displays text and keeps unsafe HTML inert', () => {
  const html = renderChatMarkdown('> **Quote**\n> > nested <script>alert(1)</script>');
  assert.match(html, /<blockquote>[\s\S]*<strong>Quote<\/strong>/);
  assert.match(html, /<blockquote>[\s\S]*<blockquote>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('safe links render but script/data links are inert', () => {
  const html = renderChatMarkdown('[Site](https://jpano.dev) [X](javascript:alert) [Bad](data:text/html,abc)');
  assert.match(html, /href="https:\/\/jpano\.dev\/"/);
  assert.doesNotMatch(html, /href="(?:javascript:|data:)/);
});

test('Mermaid source and LaTeX remain visible when plugins are not enabled', () => {
  const html = renderChatMarkdown('```mermaid\nflowchart TD\nA --> B\n```\n\n\\(E=mc^2\\)');
  assert.match(html, /mermaid \(source\)/);
  assert.match(html, /A --&gt; B/);
  assert.match(html, /E=mc\^2/);
});

test('typed commands are allowlisted with common phrasing', () => {
  assert.deepEqual(understandUiCommand('switch to dark theme'), {type:'theme',value:'dark'});
  assert.deepEqual(understandUiCommand('set theme to light'), {type:'theme',value:'light'});
  assert.deepEqual(understandUiCommand('scroll to projects'), {type:'navigate',target:'projects'});
  assert.deepEqual(understandUiCommand('go to the certificates'), {type:'navigate',target:'certificates'});
  assert.equal(understandUiCommand('delete all projects'),null);
});
