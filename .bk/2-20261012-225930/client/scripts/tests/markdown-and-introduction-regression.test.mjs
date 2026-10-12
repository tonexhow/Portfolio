import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderChatMarkdown } from '../chat/chat-markdown.js';
import { introductionFromPublished,selectIntroPortrait,introductionCardData } from '../chat/introduction.js';

test('one- and two-dash GFM table alignment is rendered, not shown verbatim',()=>{
  const raw='| Feature | Status |\n|:--|--:|\n| Markdown | Ready |\n| AI | Testing |';
  const html=renderChatMarkdown(raw);
  assert.match(html,/<table>/);
  assert.match(html,/<th scope="col" style="text-align:left">Feature<\/th>/);
  assert.match(html,/<td style="text-align:right">Ready<\/td>/);
  assert.doesNotMatch(html,/\|:--\|--:\|/);
});

test('safe link is clickable, unsafe URLs and raw HTML remain inert',()=>{
  const raw='[Portfolio](https://jpano.dev)\n[Unsafe](javascript:alert(1))\n<script>alert(1)</script>';
  const html=renderChatMarkdown(raw);
  assert.match(html,/<a href="https:\/\/jpano\.dev\/"/);
  assert.doesNotMatch(html,/<a href="javascript:/);
  assert.match(html, /class="chat-link-blocked"/);
  assert.doesNotMatch(html,/\[Unsafe\]\(javascript:/);
  assert.doesNotMatch(html,/<script>/);
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('published introductions include documented information only',()=>{
  const info={name:{full:'Jhon Anthony Pano'},headline:'IT Student · Freelancer',intro:'Builds reliable systems.',location:'Buenavista, Bohol',availability:'Open for projects',portfolio:{projects:{count:23}}};
  const text=introductionFromPublished(info,'Here is an introduction.');
  for(const phrase of ['Jhon Anthony Pano','IT Student · Freelancer','Builds reliable systems.','Buenavista, Bohol','23 projects'])assert.ok(text.includes(phrase),phrase);
  assert.doesNotMatch(text,/worked for google|restaurant owner|secret key/i);
  const card=introductionCardData(info);
  assert.equal(card.name,'Jhon Anthony Pano');
  assert.equal(card.location,'Buenavista, Bohol');
});

test('introduction portrait rotates through published choices without immediate repetition',()=>{
  const options=['/assets/profiles/1.png','/assets/profiles/2.png','/assets/profiles/3.png'];
  const first=selectIntroPortrait(options,()=>0), second=selectIntroPortrait(options,()=>0), third=selectIntroPortrait(options,()=>0);
  assert.ok(options.includes(first)&&options.includes(second)&&options.includes(third));
  assert.notEqual(first,second);
  assert.notEqual(second,third);
  assert.equal(selectIntroPortrait([],()=>0),null);
});

test('public service labels never identify implementation-specific technologies or environment variables',()=>{
  const source=readFileSync(new URL('../core/server-status.js',import.meta.url),'utf8');
  const detail=source.slice(source.indexOf('function detailLines()'),source.indexOf('function healthSummary()'));
  assert.doesNotMatch(detail,/Go Server|PostgreSQL|KaaBAG|SUPABASE_SECRET|DATABASE_URL/);
  assert.match(detail,/Server/);
  assert.match(detail,/Database/);
  assert.match(detail,/AI Assistant/);
});

test('additive schema never seeds user content or drops tables',()=>{
  const sql=readFileSync(new URL('../../../database/schema.sql',import.meta.url),'utf8');
  const uncommented=sql.split('\n').filter(line=>!/^\s*--/.test(line)).join('\n');
  assert.doesNotMatch(uncommented,/\bTRUNCATE\b|\bDROP\s+TABLE\b|\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(uncommented,/INSERT\s+INTO\s+(?:portfolio\.)?(?:projects|personal_information|certificates|feedback|contact_messages)\b/i);
});
