/* Strict Markdown/GFM subset. Untrusted HTML and links are escaped. Runnable
 * examples are NEVER executed by the renderer: Preview is an explicit click
 * inside an opaque-origin, network-isolated sandbox iframe. */
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function validLink(raw) {
  const text = String(raw || '').trim();
  if (/^#[a-z][a-z0-9_-]*$/i.test(text)) return {href:text,local:true};
  if (/^\/(?!\/)[a-z0-9/_\-#.]*$/i.test(text)) return {href:text,local:true};
  try {
    const u = new URL(text, typeof location !== 'undefined' ? location.origin : 'https://jpano.dev');
    if (!['http:', 'https:', 'mailto:', 'tel:'].includes(u.protocol) || u.username || u.password) return null;
    return {href:u.href,local:false};
  } catch {return null}
}
function validImage(raw) {
  const link = validLink(raw);
  if (!link || !(link.local || /^https:\/\//i.test(link.href))) return null;
  return link.href;
}
export function formatInline(input, ctx={}) {
  const source = String(input ?? '');
  const pattern = /(\\[\\`*_{}\[\]()#+.!>~^=-]|!\[([^\]\n]*)\]\(((?:[^\s()]|\([^()]*\))+)\)|\[([^\]\n]+)\]\(((?:[^\s()]|\([^()]*\))+)\)|\[([^\]\n]+)\]\[([^\]\n]+)\]|\[\^([^\]\n]+)\]|<((?:https?:\/\/|mailto:)[^<>\s]+)>|`([^`\n]+)`|\*\*\*([^*\n]+)\*\*\*|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|==([^=\n]+)==|\*([^*\n]+)\*|_([^_\n]+)_|\^([^\^\n]+)\^|~([^~\n]+)~)/g;
  let html='',pos=0,m;
  while ((m=pattern.exec(source))) {
    html += escape(source.slice(pos,m.index));
    if(m[1].startsWith('\\'))html+=escape(m[1].slice(1));
    else if(m[2]!==undefined){const url=ctx.allowImages?validImage(m[3]):null;html+=url?`<img loading="lazy" decoding="async" class="chat-md-image" referrerpolicy="no-referrer" src="${escape(url)}" alt="${escape(m[2])}">`:escape(m[0])}
    else if(m[4]!==undefined){const link=validLink(m[5]);html+=link?`<a href="${escape(link.href)}"${link.local?'':' target="_blank" rel="noopener noreferrer nofollow"'}>${escape(m[4])}</a>`:`<span class="chat-link-blocked" title="Unsafe or unsupported link">${escape(m[4])} <small>(link blocked)</small></span>`}
    else if(m[6]!==undefined){const link=validLink(ctx.references?.[m[7].toLowerCase()]||'');html+=link?`<a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer nofollow">${escape(m[6])}</a>`:escape(m[0])}
    else if(m[8]!==undefined){const id=m[8].toLowerCase();html+=ctx.footnotes?.[id]?`<sup><a href="#chat-footnote-${escape(id)}" class="chat-footnote-ref">[${escape(m[8])}]</a></sup>`:escape(m[0])}
    else if(m[9]!==undefined){const link=validLink(m[9]);html+=link?`<a href="${escape(link.href)}" target="_blank" rel="noopener noreferrer nofollow">${escape(m[9])}</a>`:escape(m[0])}
    else if(m[10]!==undefined)html+=`<code>${escape(m[10])}</code>`;
    else if(m[11]!==undefined)html+=`<strong><em>${escape(m[11])}</em></strong>`;
    else if(m[12]!==undefined||m[13]!==undefined)html+=`<strong>${escape(m[12]??m[13])}</strong>`;
    else if(m[14]!==undefined)html+=`<del>${escape(m[14])}</del>`;
    else if(m[15]!==undefined)html+=`<mark>${escape(m[15])}</mark>`;
    else if(m[16]!==undefined||m[17]!==undefined)html+=`<em>${escape(m[16]??m[17])}</em>`;
    else if(m[18]!==undefined)html+=`<sup>${escape(m[18])}</sup>`;
    else if(m[19]!==undefined)html+=`<sub>${escape(m[19])}</sub>`;
    pos=m.index+m[0].length;
  }
  html+=escape(source.slice(pos));
  return html.replace(/(^|[\s(])(https?:\/\/[^\s<>"']+)/g,(all,pre,url)=>{
    const stripped=url.replace(/[.,;!?]+$/,'');const safe=validLink(stripped);
    return safe?`${pre}<a href="${escape(safe.href)}" target="_blank" rel="noopener noreferrer nofollow">${escape(stripped)}</a>${escape(url.slice(stripped.length))}`:all;
  });
}
const fencePattern=/^ {0,3}(`{3,}|~{3,})([a-zA-Z0-9_+-]*)\s*$/;
const headingPattern=/^ {0,3}(#{1,6})\s+(.+)$/;
const listPattern=/^(\s{0,18})([-*+]|\d+[.)])\s+(.+)$/;
const dividerPattern=/^ {0,3}(?:---+|\*\*\*+|___+)\s*$/;
// GFM allows one or more hyphens in each delimiter cell (e.g. |:--|--:|).
// Validate each cell rather than requiring three dashes, which caused valid
// tables to be displayed verbatim in Live Chat.
function tableAlignments(line){
  const parts=String(line||'').trim().replace(/^\||\|$/g,'').split('|').map(s=>s.trim());
  if(parts.length<2||parts.length>10||parts.some(cell=>!/^:?-+:?$/.test(cell)))return null;
  return parts.map(cell=>cell.startsWith(':')&&cell.endsWith(':')?'center':cell.endsWith(':')?'right':'left');
}
function isTableDelimiter(line){return !!tableAlignments(line)};
const previewLanguages=new Set(['html','markup','frontend','client','page','webpage']);
function cells(line){return line.trim().replace(/^\||\|$/g,'').split('|').slice(0,10).map(s=>s.trim())}
function isSpecial(line){return !line.trim()||fencePattern.test(line)||headingPattern.test(line)||/^ {0,3}>/.test(line)||listPattern.test(line)||dividerPattern.test(line)}
function renderBlocks(lines,ctx,depth=0){
  if(depth>7)return `<p>${escape(lines.join('\n'))}</p>`;
  let html='',i=0;
  while(i<lines.length){
    let line=lines[i];if(!line.trim()){i++;continue}
    const fence=line.match(fencePattern);
    if(fence){
      const marker=fence[1],lang=(fence[2]||'text').toLowerCase().slice(0,24),code=[];i++;
      const end=new RegExp(`^ {0,3}${marker[0]==='`'?'`':'~'}{${marker.length},}\\s*$`);
      while(i<lines.length&&!end.test(lines[i])&&code.length<500)code.push(lines[i++]);
      if(i<lines.length&&end.test(lines[i]))i++;
      const name=lang==='mermaid'?'mermaid (source)':lang;
      html+=`<div class="chat-code" data-chat-language="${escape(lang)}"><div class="chat-code-head"><span>${escape(name)}</span><span class="chat-code-actions">${previewLanguages.has(lang)?'<button type="button" data-chat-preview aria-label="Preview this HTML in an isolated sandbox">Preview</button>':''}<button type="button" data-chat-copy aria-label="Copy code">Copy</button></span></div><pre><code>${escape(code.join('\n'))}</code></pre></div>`;
      continue;
    }
    const heading=line.match(headingPattern);
    if(heading){const level=heading[1].length;html+=`<h${level}>${formatInline(heading[2].replace(/\s+#+\s*$/,''),ctx)}</h${level}>`;i++;continue}
    if(dividerPattern.test(line)){html+='<hr>';i++;continue}
    if(i+1<lines.length&&line.includes('|')&&isTableDelimiter(lines[i+1])){
      const headers=cells(line),alignments=tableAlignments(lines[i+1]);
      if(headers.length!==alignments.length){
        // A delimiter with a mismatched column count is not a table.
        html+=`<p>${formatInline(line,ctx)}</p>`;i++;continue;
      }
      i+=2;let rows=0;
      html+=`<div class="chat-table-scroll" role="region" aria-label="Message table" tabindex="0"><table><thead><tr>${headers.map((h,j)=>`<th scope="col" style="text-align:${alignments[j]}">${formatInline(h,ctx)}</th>`).join('')}</tr></thead><tbody>`;
      while(i<lines.length&&lines[i].trim()&&lines[i].includes('|')&&rows++<30){const cols=cells(lines[i++]);html+=`<tr>${headers.map((_,j)=>`<td style="text-align:${alignments[j]}">${formatInline(cols[j]||'',ctx)}</td>`).join('')}</tr>`}
      html+='</tbody></table></div>';continue;
    }
    if(/^ {0,3}>/.test(line)){
      const quoted=[];
      while(i<lines.length&&(/^ {0,3}>/.test(lines[i])||(!lines[i].trim()&&/^ {0,3}>/.test(lines[i+1]||''))))quoted.push(lines[i++].replace(/^ {0,3}>\s?/,''));
      html+=`<blockquote>${renderBlocks(quoted,ctx,depth+1)}</blockquote>`;continue;
    }
    const list=line.match(listPattern);
    if(list){
      const indent=list[1].length,ordered=/^\d/.test(list[2]),tag=ordered?'ol':'ul';
      const start=ordered?` start="${Math.max(1,Math.min(9999,parseInt(list[2],10)||1))}"`:'';
      html+=`<${tag}${start}>`;
      while(i<lines.length){
        const li=lines[i].match(listPattern);
        if(!li||li[1].length!==indent||/^\d/.test(li[2])!==ordered)break;
        i++;const task=li[3].match(/^\[([xX ])\]\s*(.*)$/),body=task?task[2]:li[3],continued=[];
        while(i<lines.length){
          const next=lines[i],m=next.match(listPattern);
          if(m&&m[1].length<=indent)break;
          if(!next.trim()){
            if((lines[i+1]||'').trim()&&((lines[i+1].match(/^ */)||[''])[0].length>indent)){continued.push('');i++;continue}break;
          }
          if(!/^\s/.test(next))break;
          continued.push(next.slice(Math.min(next.length,indent+2)));i++;
        }
        const marker=task?`<input type="checkbox" tabindex="-1" aria-label="Task ${escape(body)}" disabled${task[1].toLowerCase()==='x'?' checked':''}>`:'';
        html+=`<li${task?' class="chat-task"':''}><span class="chat-task-row">${marker}<span class="chat-li-content">${formatInline(body,ctx)}</span></span>${continued.length?renderBlocks(continued,ctx,depth+1):''}</li>`;
      }
      html+=`</${tag}>`;continue;
    }
    const paragraph=[line];i++;
    while(i<lines.length&&!isSpecial(lines[i])&&!(lines[i].includes('|')&&isTableDelimiter(lines[i+1]||'')))paragraph.push(lines[i++]);
    html+=`<p>${paragraph.map(part=>formatInline(part,ctx)).join('<br>')}</p>`;
  }
  return html;
}
export function renderChatMarkdown(source,opts={}){
  const clean=String(source??'').slice(0,65000).replace(/\r\n?/g,'\n');
  const references={},footnotes={},lines=[];
  for(const line of clean.split('\n')){
    const ref=line.match(/^\[([^\]]+)\]:\s*(https?:\/\/\S+)\s*$/);
    const foot=line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if(foot){footnotes[foot[1].toLowerCase()]=foot[2];continue}
    if(ref){references[ref[1].toLowerCase()]=ref[2];continue}
    lines.push(line);
  }
  const ctx={references,footnotes,allowImages:opts.allowImages!==false};let html=renderBlocks(lines,ctx)||'<p></p>';
  const used=Object.entries(footnotes).filter(([id])=>clean.includes(`[^${id}]`));
  if(used.length)html+=`<section class="chat-footnotes" aria-label="Footnotes"><hr><ol>${used.map(([id,value])=>`<li id="chat-footnote-${escape(id)}">${formatInline(value,ctx)}</li>`).join('')}</ol></section>`;
  return html;
}
const sandboxCSP="default-src 'none'; base-uri 'none'; form-action 'none'; connect-src 'none'; img-src data: blob:; font-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
export function createSandboxDocument(raw){
  // Never treat a network script or stylesheet as trusted page code. Frame has
  // sandbox=allow-scripts WITHOUT allow-same-origin (opaque unique origin).
  const csp=`<meta http-equiv="Content-Security-Policy" content="${sandboxCSP}">`;
  const content=String(raw??'').slice(0,38000);
  if(/<html[\s>]/i.test(content)) {
    // Some valid HTML pages have no explicit head. Always insert the CSP at
    // the start of the document, before any script, style, or resource tag.
    if(/<head(?:\s[^>]*)?>/i.test(content))return content.replace(/<head([^>]*)>/i,`<head$1>${csp}`);
    return content.replace(/<html([^>]*)>/i,`<html$1><head>${csp}</head>`);
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">${csp}<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:1rem;font:16px/1.5 system-ui}</style></head><body>${content}</body></html>`;
}
function previewCode(block){
  if(!block||!previewLanguages.has(block.dataset.chatLanguage))return;
  const raw=block.querySelector('pre code')?.textContent||'';
  let dialog=document.getElementById('chatSandboxPreview');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='chatSandboxPreview';dialog.className='chat-preview-dialog';
    dialog.innerHTML='<header><strong>Isolated webpage preview</strong><span>Untrusted code · network blocked</span><button type="button" data-close-preview aria-label="Close preview">✕</button></header><div class="chat-preview-frame"></div><footer>HTML, CSS and JavaScript run only inside a restricted sandbox. No access to portfolio cookies, storage, or API.</footer>';
    dialog.addEventListener('click',e=>{if(e.target===dialog||e.target.closest('[data-close-preview]'))dialog.close()});
    dialog.addEventListener('close',()=>{dialog.querySelector('.chat-preview-frame').replaceChildren()});
    document.body.append(dialog);
  }
  const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('referrerpolicy','no-referrer');frame.setAttribute('title','Untrusted webpage sandbox preview');frame.srcdoc=createSandboxDocument(raw);
  dialog.querySelector('.chat-preview-frame').replaceChildren(frame);dialog.showModal();
}
const wired=new WeakSet();
export function wireChatCopy(root=document){
  if(!root||wired.has(root))return;wired.add(root);
  root.addEventListener('click',async event=>{
    const preview=event.target.closest('[data-chat-preview]');
    if(preview){previewCode(preview.closest('.chat-code'));return}
    const button=event.target.closest('[data-chat-copy]');if(!button)return;
    const code=button.closest('.chat-code')?.querySelector('code')?.textContent||'';
    try{await navigator.clipboard.writeText(code);button.textContent='Copied';setTimeout(()=>{if(button.isConnected)button.textContent='Copy'},1400)}
    catch{window.UI?.toast?.('Clipboard is unavailable.',{title:'Copy',type:'error'})}
  });
}
