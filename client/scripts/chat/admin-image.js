/* Images are rendered only for messages authenticated by the server as Admin.
 * Never interpret raw user/AI HTML. Only explicit, validated image tokens
 * become DOM elements; ordinary text continues through safe Markdown. */
export function safeAdminImageURL(value){
 const raw=String(value||'').trim().replace(/^['"]|['"]$/g,'');
 if(/^\/api\/chat\/images\/ci_[A-Za-z0-9_-]{16,80}$/.test(raw))return raw;
 const address=/^www\./i.test(raw)?'https://'+raw:raw;
 try{
  const u=new URL(address);const host=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>1500||!host.includes('.'))return null;
  if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.test')||host.endsWith('.invalid')||host.endsWith('.onion')||host.startsWith('[')||/^\d/.test(host))return null;
  return u.href;
 }catch{return null}
}
export function adminImageURL(sender,body){
 if(sender!=='admin')return null;
 const source=String(body||'').trim();
 const match=source.match(/^\/img\s+(\S+)$/i)||source.match(/^<img\s+([^<>\s]+)>$/i)||source.match(/^<img\s+src\s*=\s*(['"])(.*?)\1\s*\/?\s*>$/i);
 return match?safeAdminImageURL(match[2]||match[1]):null;
}
/* Inline <img src="URL"> images appear at their position in the text; /img
 * URL images always render below the surrounding text. Tokens with invalid
 * URLs remain literal text and never cause a network request. */
export function parseAdminRichContent(sender,body){
 const source=String(body||'');
 if(sender!=='admin')return {text:source,inline:[],bottom:[]};
 const inline=[],bottom=[];
 const inlinePattern=/<img\s+src\s*=\s*(?:"([^"]{1,1500})"|'([^']{1,1500})')\s*\/?\s*>|<img\s+(https?:\/\/[^<>\s]+|www\.[^<>\s]+)>/gi;
 let result=source.replace(inlinePattern,(token,quoted1,quoted2,legacy)=>{
  const url=safeAdminImageURL(quoted1||quoted2||legacy);
  if(!url)return token;
  const marker=`JPANO_INLINE_IMAGE_${inline.length}_PLACEHOLDER`;
  inline.push({marker,url});return marker;
 });
 // Only a terminal /img token or a standalone line can append an image.
 result=result.replace(/(?:^|\s)\/img\s+((?:https:\/\/|www\.|\/api\/chat\/images\/)[^\s<>]{1,1500})(?=\s|$)/gi,(token,raw)=>{
  const url=safeAdminImageURL(raw);
  if(!url)return token;
  bottom.push(url);return ' ';
 });
 return {text:result.trim(),inline,bottom};
}
function imageNode(url,inline=false){
 const wrap=document.createElement(inline?'span':'figure');wrap.className=inline?'chat-admin-inline-image':'chat-admin-image';
 const resolved=url.startsWith('/api/chat/images/')?window.APIManager.apiURL(url):url;
 const img=document.createElement('img');img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.alt='Image shared by Admin';img.src=resolved;
 const link=document.createElement('a');link.href=resolved;link.target='_blank';link.rel='noopener noreferrer nofollow';link.referrerPolicy='no-referrer';link.textContent='Open image';
 img.addEventListener('error',()=>{img.hidden=true;link.textContent='Image preview unavailable · Open link'});
 wrap.append(img,link);return wrap;
}
export function renderAdminImage(sender,body){const url=adminImageURL(sender,body);return url?imageNode(url):null}
/* Pass the existing safe Markdown renderer, never an HTML sanitizer bypass. */
export function renderAdminRichMessage(sender,body,markdownRenderer){
 const parsed=parseAdminRichContent(sender,body);
 const wrap=document.createElement('div');wrap.className='chat-admin-rich-body';
 const markdown=document.createElement('div');markdown.className='chat-message-markdown';
 // Existing renderer sanitizes untrusted Markdown/HTML. Placeholder replacement
 // happens in text nodes only, so no visitor HTML is ever parsed as a tag.
 markdown.innerHTML=markdownRenderer(parsed.text,{allowImages:sender==='admin'});
 if(parsed.inline.length){
  const placeholders=new Map(parsed.inline.map(x=>[x.marker,x.url]));
  const pattern=/JPANO_INLINE_IMAGE_\d+_PLACEHOLDER/g;
  const walker=document.createTreeWalker(markdown,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())if(pattern.test(walker.currentNode.nodeValue)){nodes.push(walker.currentNode);pattern.lastIndex=0}
  for(const node of nodes){
   const fragment=document.createDocumentFragment(),source=node.nodeValue;
   let offset=0;pattern.lastIndex=0;
   for(const match of source.matchAll(pattern)){
    if(match.index>offset)fragment.append(document.createTextNode(source.slice(offset,match.index)));
    const url=placeholders.get(match[0]);fragment.append(url?imageNode(url,true):document.createTextNode(match[0]));
    offset=match.index+match[0].length;
   }
   if(offset<source.length)fragment.append(document.createTextNode(source.slice(offset)));
   node.replaceWith(fragment);
  }
 }
 wrap.append(markdown);for(const url of parsed.bottom)wrap.append(imageNode(url));
 return wrap;
}
