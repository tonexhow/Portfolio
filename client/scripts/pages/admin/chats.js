import {$,escapeHTML,confirmAction} from "./helpers.js";
import {renderChatMarkdown,wireChatCopy} from "../../chat/chat-markdown.js";
import {bindChatComposer} from "../../chat/chat-composer.js";
import {bindTextAttachment,bindChatDrop} from "../../chat/text-attachments.js";
import {bindSlashCommands,parseQuickCommand,openCommandHelp} from "../../chat/slash-commands.js";
import {renderAdminRichMessage} from "../../chat/admin-image.js";

let items=[], selected="", socket=null, reconnectTimer=null, disposed=false;
let page=1,totalPages=1,totalItems=0,unreadTotal=0;
let historyCursor=null,hasOlder=false,busyOlder=false;
const clearedChatViewAt=new Map(); // Local display only; server chat/payment records are immutable.
function wsURL(){return window.APIManager.chatWebSocketURL("/api/admin/chat/ws")}
function apiURL(path){return path?window.APIManager.apiURL(path):""}
function setTransport(live){const el=$("#chatTransportState");el?.classList.toggle("live",live);if(el)el.innerHTML=`<i></i>${live?"Live connection":"Reconnecting…"}`}
function setUnread(n){const b=$("#chatUnreadBadge");if(!b)return;n=Math.max(0,Number(n)||0);b.textContent=n>99?"99+":String(n);b.hidden=!n}
function shortThread(id=""){return id.replace(/^chat_/,"#")}
function visibleAfterLocalClear(id,m){const cut=clearedChatViewAt.get(id)||0;return !cut||new Date(m.created_at).getTime()>cut}
function humanDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?"—":d.toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
function avatarHTML(x,size="table"){
  if(x?.visitor_auth_provider&&x.visitor_avatar_url){return `<img class="chat-identity-avatar ${size}" src="${escapeHTML(apiURL(x.visitor_avatar_url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`}
  return `<span class="chat-identity-avatar placeholder ${size}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="3"/><path d="M5 20c0-4 3-6 7-6s7 2 7 6"/></svg></span>`;
}
function identityHTML(x){
  const name=x.visitor_auth_name||"Anonymous visitor";
  const detail=x.visitor_auth_provider?`Verified · ${x.visitor_auth_provider}`:"Guest · no OAuth";
  return `<span class="chat-identity-cell">${avatarHTML(x)}<span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(detail)}</small></span></span>`;
}
function renderTable(){
  const body=$("#chatTableBody");if(!body)return;
  if(!items.length){body.innerHTML='<tr><td colspan="4" class="chat-table-empty">No conversations found.</td></tr>';return}
  body.innerHTML=items.map(x=>`<tr data-id="${escapeHTML(x.id)}" class="${x.id===selected?'active':''}" tabindex="0" aria-label="Open ${escapeHTML(x.visitor_auth_name||'anonymous visitor')} conversation">
    <td class="chat-thread-cell"><strong>${escapeHTML(shortThread(x.id))}</strong>${x.admin_unread?`<span class="chat-unread">${x.admin_unread}</span>`:""}</td>
    <td>${identityHTML(x)}</td>
    <td class="chat-last-message">${escapeHTML((x.last_sender?`${x.last_sender==='admin'?'You':x.visitor_auth_name||'Visitor'}: `:'')+(x.last_message||'No messages yet'))}</td>
    <td class="chat-updated"><time>${escapeHTML(humanDate(x.last_message_at))}</time></td>
  </tr>`).join("");
  for(const row of body.querySelectorAll("tr[data-id]")){
    row.addEventListener("click",()=>void openThread(row.dataset.id));
    row.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();void openThread(row.dataset.id)}});
  }
}
function renderPagination(){
  const label=$("#chatPage"),prev=$("#chatPrev"),next=$("#chatNext"),wrap=$("#chatPagination");
  if(label)label.textContent=`Page ${page} of ${totalPages} · ${totalItems} conversation${totalItems===1?"":"s"}`;
  if(prev)prev.disabled=page<=1;
  if(next)next.disabled=page>=totalPages;
  if(wrap)wrap.hidden=totalItems===0;
}
function clearConversation(){selected="";const panel=$("#chatConversation");if(panel)panel.innerHTML='<div class="chat-conversation-empty">Select a conversation to view messages.</div>';renderTable()}
async function changePage(next){const target=Math.min(Math.max(1,next),totalPages);if(target===page)return;page=target;clearConversation();await loadChats()}
export async function loadChats(){
  const result=await window.APIManager.getAdminChats(page);
  page=Math.max(1,Number(result.page)||1);totalPages=Math.max(1,Number(result.total_pages)||1);
  totalItems=Math.max(0,Number(result.total_items)||0);items=result.items||[];
  unreadTotal=Math.max(0,Number(result.unread)||0);setUnread(unreadTotal);
  renderTable();renderPagination();
}
function bubble(m){
  const sender=m.sender==="admin"?"admin":"visitor";
  const time=new Date(m.created_at);
  const validTime=Number.isNaN(time.getTime())?new Date():time;
  return `<article class="admin-chat-bubble ${sender}" data-id="${escapeHTML(String(m.id||''))}">
    <div class="chat-message-markdown"></div>
    <time datetime="${escapeHTML(validTime.toISOString())}">${escapeHTML(validTime.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}))}</time>
  </article>`;
}
function hydrateAdminImages(container){
 container?.querySelectorAll('.admin-chat-bubble').forEach(bubble=>{
  const content=bubble.querySelector('.chat-message-markdown');
  if(!content||content.dataset.rendered==='true')return;
  const message=adminMessageCache.get(bubble.dataset.id);if(!message)return;
  content.dataset.rendered='true';
  if(message.sender==='admin')content.replaceWith(renderAdminRichMessage(message.sender,message.body,renderChatMarkdown));
  else content.innerHTML=renderChatMarkdown(message.body,{allowImages:false});
 });
}
const adminMessageCache=new Map();
function rememberMessages(messages){for(const m of messages||[])adminMessageCache.set(String(m.id),m)}
function detailsForOffer(o){const nf=new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'});const money=v=>nf.format((Number(v)||0)/100);const pct=o.price_centavos?Math.min(100,Math.round(o.paid_centavos/o.price_centavos*100)):0;return {money,pct}}
function adminOfferCard(o){
 if(!o?.id)return;const box=$('#adminChatMessages');if(!box)return;
 let card=[...box.querySelectorAll('.admin-project-offer-card')].find(el=>el.dataset.offerId===o.id);
 if(!card){card=document.createElement('article');card.className='admin-project-offer-card';card.dataset.offerId=o.id;box.append(card)}
 const {money,pct}=detailsForOffer(o);const badge=o.status==='paid'?'Fully paid':o.paid_centavos>0?'Partially paid':o.status==='cancelled'?'Cancelled':'Awaiting downpayment';
 card.replaceChildren();
 const top=document.createElement('div');top.className='offer-card-topline';const kicker=document.createElement('small');kicker.textContent='PROJECT PROPOSAL';const status=document.createElement('span');status.className='offer-card-status';status.dataset.state=o.status;status.textContent=badge;top.append(kicker,status);
 const title=document.createElement('strong');title.textContent=o.title;
 const desc=document.createElement('p');desc.textContent=o.description||'No further scope notes.';
 const values=document.createElement('div');values.className='admin-offer-stats';values.textContent=`Total ${money(o.price_centavos)} · Received ${money(o.paid_centavos)} · Due ${money(Math.max(0,o.price_centavos-o.paid_centavos))}`;
 const track=document.createElement('div');track.className='offer-card-track';const fill=document.createElement('i');fill.style.width=`${pct}%`;track.append(fill);
 const actions=document.createElement('button');actions.type='button';actions.textContent='View transactions';actions.addEventListener('click',()=>document.querySelector('[data-admin-view="transactions"]')?.click());
 card.append(top,title,desc,values,track,actions);box.scrollTop=box.scrollHeight;
}
async function refreshAdminOffers(id){try{const data=await window.APIManager.getAdminChatOffers(id);if(selected!==id)return;const visible=new Set((data.offers||[]).map(o=>o.id));document.querySelectorAll('#adminChatMessages .admin-project-offer-card').forEach(card=>{if(!visible.has(card.dataset.offerId))card.remove()});(data.offers||[]).forEach(adminOfferCard)}catch{}}
function detailValue(v,fallback="Not available"){return escapeHTML(v||fallback)}
function threadHead(x){
  const name=x?.visitor_auth_name||"Anonymous visitor";
  const auth=x?.visitor_auth_provider?`Verified via ${x.visitor_auth_provider}`:"Guest visitor";
  return `<header class="chat-conversation-head"><div class="chat-thread-profile">${avatarHTML(x,"detail")}<div><span class="chat-thread-kicker">${escapeHTML(shortThread(x?.id||selected))}</span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(auth)}</small></div></div>
    <button type="button" id="deleteChatButton" class="icon-button" title="Delete conversation" aria-label="Delete conversation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg></button></header>
  <details class="chat-thread-details"><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg> Visitor connection details <span aria-hidden="true">⌄</span></summary>
   <div class="chat-thread-meta"><span><b>Browser</b>${detailValue(x?.visitor_agent)}</span><span><b>Device</b>${detailValue(x?.visitor_platform)}</span><span><b>IP</b><code>${detailValue(x?.visitor_ip)}</code></span><span><b>Country</b>${detailValue(x?.visitor_country,"Local / unavailable")}</span><span><b>Fingerprint</b><code>${detailValue(x?.visitor_fingerprint)}</code></span><span class="wide"><b>User agent</b><code>${detailValue(x?.visitor_user_agent)}</code></span></div>
  </details>`;
}
function acceptProjectModal(threadID,inquiry=null){
  if(!threadID){window.UI.toast('Choose a conversation first.',{title:'Projects',type:'error'});return}
  let dialog=document.getElementById('adminAcceptProjectModal');
  if(!dialog){
    dialog=document.createElement('dialog');dialog.id='adminAcceptProjectModal';dialog.className='project-offer-modal admin-offer-modal';
    dialog.innerHTML=`<form id="acceptProjectForm"><header><div><small>Admin · Project proposal</small><h2>Create a project offer</h2></div><button type="button" id="closeAcceptProject" aria-label="Close">✕</button></header>
      <div class="offer-modal-scroll"><label>Project title<input name="title" maxlength="120" minlength="3" required placeholder="e.g. Restaurant POS and inventory"></label>
      <label>Description<textarea name="description" maxlength="1400" rows="4" placeholder="Deliverables, scope, exclusions, and schedule"></textarea></label>
      <div class="offer-fields"><label>Agreed price (PHP)<input name="price" type="number" min="1" max="5000000" step="0.01" required placeholder="25000.00"></label>
      <label>Minimum downpayment (%)<input name="downpayment_percent" type="number" min="1" max="100" step="1" value="30" required></label></div>
      <label>Admin note (optional)<textarea name="note" maxlength="1000" rows="3" placeholder="Revised scope, pricing explanation or delivery notes"></textarea></label>
      <p class="offer-note">Accepting an inquiry links it to a project offer. Only PayMongo-verified payments update the balance.</p></div>
      <footer><button type="button" id="cancelAcceptProject">Cancel</button><button type="submit" id="sendAcceptProject">Send project offer</button></footer></form>`;
    dialog.querySelector('#closeAcceptProject').addEventListener('click',()=>dialog.close());
    dialog.querySelector('#cancelAcceptProject').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});
    dialog.querySelector('form').addEventListener('submit',async e=>{
      e.preventDefault();const form=e.currentTarget,data=new FormData(form),send=dialog.querySelector('#sendAcceptProject');
      if(!dialog.dataset.thread)return;
      const payload={title:String(data.get('title')||'').trim(),description:String(data.get('description')||'').trim(),price:Number(data.get('price')),downpayment_percent:Number(data.get('downpayment_percent')),note:String(data.get('note')||'').trim(),inquiry_id:dialog.dataset.inquiry||''};
      send.disabled=true;send.textContent='Sending offer…';
      try{await window.APIManager.createProjectOffer(dialog.dataset.thread,payload);dialog.close();form.reset();window.UI.toast('Project proposal created. Visitor can view its verified payment progress.',{title:'Offer created'});void refreshAdminOffers(dialog.dataset.thread);}
      catch(err){window.UI.toast(err.message,{title:'Offer unavailable',type:'error'})}
      finally{send.disabled=false;send.textContent='Send project offer'}
    });
    document.body.append(dialog);
  }
  dialog.querySelector('form').reset();
  dialog.dataset.thread=threadID;dialog.dataset.inquiry=inquiry?.id||'';
  if(inquiry){dialog.querySelector('[name="title"]').value=inquiry.title||'';dialog.querySelector('[name="description"]').value=inquiry.description||'';dialog.querySelector('[name="price"]').value=Number(inquiry.requested_centavos||0)/100}
  dialog.querySelector('header h2').textContent=inquiry?'Review and accept inquiry':'Create a project offer';
  dialog.showModal();dialog.querySelector('[name="title"]').focus();
}
async function openAdminProjects(onlyPending=false){
 if(!selected)return;
 let d=document.getElementById('adminProjectManager');
 if(!d){
  d=document.createElement('dialog');d.id='adminProjectManager';d.className='project-offer-modal project-inquiry-modal admin-project-manager';
  d.innerHTML='<header><h2>Conversation projects</h2><button type="button" aria-label="Close">✕</button></header><div class="project-inquiry-items"></div>';
  d.querySelector('header button').addEventListener('click',()=>d.close());d.addEventListener('click',e=>{if(e.target===d)d.close()});document.body.append(d);
 }
 const content=d.querySelector('.project-inquiry-items');content.textContent='Loading project inquiries and offers…';d.showModal();
 try{
  const [requests,offers]=await Promise.all([window.APIManager.getAdminChatInquiries(selected),window.APIManager.getAdminChatOffers(selected)]);
  content.replaceChildren();const inquiries=(requests.items||[]).filter(x=>!onlyPending||x.status==='pending');const agreements=onlyPending?[]:(offers.offers||[]);
  d.querySelector('header h2').textContent=onlyPending?`Pending project inquiries (${inquiries.length})`:`Projects (${agreements.length}) · Inquiries (${inquiries.length})`;
  if(!inquiries.length&&!agreements.length){content.textContent=onlyPending?'There are no pending inquiries for this conversation.':'No project inquiries or offers in this conversation.';return}
  for(const inquiry of inquiries){
   const card=document.createElement('article');card.className='project-inquiry-item';
   const small=document.createElement('small');small.textContent=`INQUIRY · ${inquiry.status}`;
   const title=document.createElement('strong');title.textContent=inquiry.title;
   const desc=document.createElement('p');desc.textContent=inquiry.description;
   const price=document.createElement('span');price.textContent=`Requested PHP ${(Number(inquiry.requested_centavos||0)/100).toLocaleString('en-PH',{minimumFractionDigits:2})}`;
   card.append(small,title,desc,price);
   if(inquiry.status==='pending'){
    const accept=document.createElement('button');accept.type='button';accept.textContent='Review / Accept';accept.addEventListener('click',()=>{d.close();acceptProjectModal(selected,inquiry)});card.append(accept);
    const decline=document.createElement('button');decline.type='button';decline.className='danger';decline.textContent='Decline';decline.addEventListener('click',async()=>{
     if(!await confirmAction({title:'Decline request?',message:'The client will see that this inquiry was declined.',confirmLabel:'Decline'}))return;
     try{await window.APIManager.updateAdminInquiry(inquiry.id,{status:'declined',note:'Declined after review'});void openAdminProjects(onlyPending)}catch(e){window.UI.toast(e.message,{title:'Inquiry',type:'error'})}
    });card.append(decline);
   }content.append(card);
  }
  for(const o of agreements){
   const card=document.createElement('article');card.className='project-inquiry-item';const title=document.createElement('strong');title.textContent=o.title;
   const desc=document.createElement('p');desc.textContent=o.description||'No scope notes';
   const totals=document.createElement('span');totals.textContent=`${o.status==='paid'?'Fully paid':Number(o.paid_centavos)>0?'Partially paid':'Awaiting downpayment'} · Received PHP ${(Number(o.paid_centavos||0)/100).toFixed(2)} / PHP ${(Number(o.price_centavos||0)/100).toFixed(2)}`;
   card.append(title,desc,totals);
   const archive=document.createElement('button');archive.type='button';archive.className='danger';archive.textContent='Remove card';archive.addEventListener('click',async()=>{
    if(!await confirmAction({title:'Archive this project?',message:'Hide the project offer from chats. Verified financial records and paid amounts remain preserved.',confirmLabel:'Archive project'}))return;
    try{await window.APIManager.archiveProjectOffer(o.id);void openAdminProjects(onlyPending);void refreshAdminOffers(selected)}catch(e){window.UI.toast(e.message,{title:'Project',type:'error'})}
   });card.append(archive);content.append(card);
  }
 }catch(e){content.textContent=e.message||'Unable to load projects.'}
}
function scrollMessages(){const box=$("#adminChatMessages");if(box)box.scrollTop=box.scrollHeight}
function updateOlder(){const older=$("#adminChatOlder");if(older){older.hidden=!hasOlder;older.disabled=busyOlder;older.textContent=busyOlder?"Loading…":"Load older messages"}}
async function loadOlder(){
  if(!selected||!hasOlder||!historyCursor||busyOlder)return;
  const id=selected;busyOlder=true;updateOlder();
  try{
    const box=$("#adminChatMessages");if(!box)return;
    const beforeHeight=box.scrollHeight,beforeTop=box.scrollTop;
    const response=await window.APIManager.getAdminChatMessages(id,historyCursor);
    if(selected!==id)return;
    const existing=new Set([...box.querySelectorAll("[data-id]")].map(x=>x.dataset.id));
    const messages=(response.messages||[]).filter(m=>!existing.has(String(m.id)));
    rememberMessages(messages);
    const fragment=document.createElement("template");fragment.innerHTML=messages.map(bubble).join("");
    const older=$("#adminChatOlder");box.insertBefore(fragment.content,older?.nextSibling||box.firstChild);
    hydrateAdminImages(box);
    box.scrollTop=beforeTop+(box.scrollHeight-beforeHeight);
    hasOlder=!!response.has_more;historyCursor=response.next_before||null;
  }catch(error){window.UI.toast(error.message,{title:"Chat history",type:"error"})}
  finally{busyOlder=false;updateOlder()}
}
async function openThread(id){
  selected=id;renderTable();
  const panel=$("#chatConversation");if(!panel)return;
  panel.innerHTML='<div class="chat-conversation-empty">Loading messages…</div>';
  try{
    const data=await window.APIManager.getAdminChatMessages(id);
    if(selected!==id)return;
    const x=data.thread||items.find(v=>v.id===id)||{id};
    hasOlder=!!data.has_more&&!clearedChatViewAt.has(id);historyCursor=data.next_before||null;
    const viewMessages=(data.messages||[]).filter(m=>visibleAfterLocalClear(id,m));
    rememberMessages(viewMessages);
    panel.innerHTML=`${threadHead(x)}<div class="chat-conversation-messages" id="adminChatMessages"><button type="button" class="chat-load-older" id="adminChatOlder" ${hasOlder?"":"hidden"}>Load older messages</button>${viewMessages.map(bubble).join("")||'<div class="admin-empty">No messages in the current view.</div>'}</div><form class="chat-admin-form" id="adminChatForm"><button type="button" class="admin-chat-attach" id="adminChatAttach" title="Attach a text or Word document" aria-label="Attach a document">＋</button><input id="adminChatFile" type="file" accept=".txt,.md,.markdown,.html,.css,.js,.ts,.json,.csv,.xml,.yaml,.yml,.log,.docx,.png,.jpg,.jpeg,.gif,.webp" hidden><textarea id="adminChatInput" rows="1" maxlength="12000" placeholder="Write a reply… or type / for commands" autocomplete="off" aria-label="Reply to visitor" required></textarea><button type="submit" title="Send reply" aria-label="Send reply">Send</button></form>`;
    hydrateAdminImages(panel);void refreshAdminOffers(id);
    $("#adminChatOlder")?.addEventListener("click",()=>void loadOlder());
    const form=panel.querySelector("#adminChatForm"),input=$("#adminChatInput");
    bindChatComposer(input);
    bindSlashCommands(input,'admin');
    // File images go through private Admin upload; text/DOCX keep existing extraction.
    const imageFile=$('#adminChatFile'),imageButton=$('#adminChatAttach');
    const uploadImage=async(file)=>{
      if(!file||!/^image\/(png|jpeg|gif|webp)$/.test(file.type)||file.size>4*1024*1024){window.UI.toast('Use a PNG, JPG, GIF or WebP image under 4 MB.',{title:'Chat image',type:'error'});return false}
      if(!selected){window.UI.toast('Choose a conversation first.',{title:'Chat image',type:'error'});return false}
      imageButton.disabled=true;
      try{const response=await window.APIManager.uploadAdminChatImage(selected,file);
        input.value=[input.value.trim(),`/img ${response.url}`].filter(Boolean).join(' ');
        input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
        window.UI.toast('Image attached. Press Send to share.',{title:'Chat image'});return true;
      }catch(err){window.UI.toast(err.message,{title:'Image upload',type:'error'});return false}
      finally{imageButton.disabled=false}
    };
    imageFile.addEventListener('change',event=>{
      const file=event.target.files?.[0];if(file&&file.type.startsWith('image/')){
        event.stopImmediatePropagation();void uploadImage(file);imageFile.value='';
      }
    },true);
    bindTextAttachment(input,imageFile,imageButton);
    // A pasted /img data:image/... base64 value is converted to a private
    // uploaded image, not sent as megabytes of chat text.
    input.addEventListener('paste',event=>{
      const text=event.clipboardData?.getData('text/plain')?.trim()||'';
      const match=text.match(/^(?:\/img\s+)?(data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=\s]+))$/i);
      if(!match)return;
      event.preventDefault();const encoded=match[3].replace(/\s/g,'');
      if(encoded.length>Math.ceil(4*1024*1024*4/3)+16){window.UI.toast('Image is too large. Maximum 4 MB.',{title:'Chat image',type:'error'});return}
      try{const bytes=atob(encoded),payload=new Uint8Array(bytes.length);
        for(let i=0;i<bytes.length;i++)payload[i]=bytes.charCodeAt(i);
        void uploadImage(new File([payload],'chat-image.'+(match[2]==='jpeg'?'jpg':match[2]),{type:'image/'+match[2]}));
      }catch{window.UI.toast('Invalid base64 image. Attach the original file instead.',{title:'Chat image',type:'error'})}
    });
    bindChatDrop(input,form,uploadImage);
    form?.addEventListener("submit",e=>{
      e.preventDefault();const body=input.value.trim();
      if(!body)return;
      if(body.toLowerCase()==='/ai'){
        input.value='';window.UI.toast('Checking AI providers; this may take a moment.',{title:'Tonex diagnostic'});
        void window.APIManager.testAIHealth().then(res=>{
          const text=(res.providers||[]).map(p=>`${p.provider}: ${p.status}`).join(' · ')||'No configured routes';
          window.UI.toast(text,{title:'Provider health',timeout:10000});
        }).catch(err=>window.UI.toast(err.message,{title:'Provider diagnostics',type:'error'}));return;
      }
      if(body.toLowerCase()==='/getaichat'){
        input.value='';
        const shared=[...document.querySelectorAll('#adminChatMessages .admin-chat-bubble')].filter(n=>n.textContent?.includes('Tonex Bot handoff'));
        if(shared.length){shared[shared.length-1].scrollIntoView({block:'center',behavior:'smooth'});window.UI.toast('Showing the visitor-approved Tonex handoff.',{title:'Chat history'})}
        else window.UI.toast('No visitor-approved Tonex transcript is available in this conversation. Ask the visitor to run /getaichat in Bot chat.',{title:'Chat history',type:'warning'});
        return;
      }
      const command=parseQuickCommand(body,'admin');
      if(command&&command.name!='/img'){
        input.value="";input.dispatchEvent(new Event('input'));
        switch(command.name){
          case '/acceptproject':void openAdminProjects(true);break;
          case '/createproject':acceptProjectModal(selected);break;
          case '/projects':void openAdminProjects(false);break;
          case '/transactions':document.querySelector('[data-admin-view="transactions"]')?.click();break;
          case '/offers':void refreshAdminOffers(selected);break;
          case '/help':openCommandHelp(input,'admin');break;
          case '/status':window.UI.toast(socket?.readyState===WebSocket.OPEN?'Live connection available':'Waiting for reconnection',{title:'Chat connection'});break;
          case '/clear':{const threadToClear=selected;void confirmAction({title:'Clear displayed messages?',message:'This hides previously received messages in this Admin view. Server chat and financial history remain preserved.',confirmLabel:'Clear view'}).then(ok=>{if(!ok||!threadToClear)return;clearedChatViewAt.set(threadToClear,Date.now());if(selected===threadToClear){hasOlder=false;const box=$('#adminChatMessages');box?.querySelectorAll('.admin-chat-bubble').forEach(n=>n.remove());const older=$('#adminChatOlder');if(older)older.hidden=true}window.UI.toast('Chat view cleared. New messages will still appear.',{title:'Chat'})});break;}
        }return;
      }
      if(command?.name==='/img'&&!command.arg){window.UI.toast('Use /img https://example.com/photo.jpg or attach an image file.',{title:'Image command',type:'error'});return}
      if(/data:image\/(?:png|jpeg|gif|webp);base64,/i.test(body)){
        window.UI.toast('Paste the image again or use the attachment button. A data URL must be uploaded before sending.',{title:'Image is too large',type:'error'});return;
      }
      if(!socket||socket.readyState!==WebSocket.OPEN){window.UI.toast("Live connection is not ready.",{title:"Chats",type:"error"});return}
      socket.send(JSON.stringify({action:"send",thread_id:selected,body}));input.value="";
    });
    input?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form?.requestSubmit()}});
    panel.querySelector("#deleteChatButton")?.addEventListener("click",async()=>{
      const ok=await confirmAction({title:"Delete conversation?",message:"This removes the chat and retained visitor metadata immediately.",confirmLabel:"Delete chat"});
      if(!ok)return;
      try{await window.APIManager.deleteAdminChat(selected);clearConversation();await loadChats();window.UI.toast("Conversation deleted.",{title:"Chats"})}
      catch(error){window.UI.toast(error.message,{title:"Chats",type:"error"})}
    });
    const count=Number(items.find(v=>v.id===id)?.admin_unread)||0;
    unreadTotal=Math.max(0,unreadTotal-count);items=items.map(v=>v.id===id?{...v,admin_unread:0}:v);
    setUnread(unreadTotal);renderTable();scrollMessages();
  }catch(error){if(selected===id)panel.innerHTML='<div class="chat-conversation-empty">Unable to load conversation.</div>';window.UI.toast(error.message,{title:"Chats",type:"error"})}
}
function handleEvent(x){
  if(x.type==="message"){
    void loadChats().catch(()=>{});
    if(x.message?.thread_id===selected&&visibleAfterLocalClear(selected,x.message)){
      const box=$("#adminChatMessages");box?.querySelector(".admin-empty")?.remove();
      if(box&&!box.querySelector(`[data-id="${CSS.escape(String(x.message.id))}"]`)){
        rememberMessages([x.message]);box.insertAdjacentHTML("beforeend",bubble(x.message));hydrateAdminImages(box);scrollMessages();
      }
    }
  }else if(x.type==="project_offer"){
    document.dispatchEvent(new CustomEvent("portfolio:payment-update",{detail:{offer:x.offer,threadId:x.thread_id}}));
    if(x.thread_id===selected){adminOfferCard(x.offer);window.UI.toast(`Project ${x.offer?.paid_centavos>0?'payment updated':'proposal updated'}: ${x.offer?.title||'Project'}`,{title:'Project status'})}
  }else if(x.type==="thread")void loadChats().catch(()=>{});
}
function connect(){
  clearTimeout(reconnectTimer);if(disposed||socket&&socket.readyState<2)return;
  try{socket=new WebSocket(wsURL())}catch{return}
  socket.onopen=()=>{setTransport(true);document.dispatchEvent(new Event("portfolio:payment-reconnected"));};
  socket.onmessage=e=>{try{handleEvent(JSON.parse(e.data))}catch{}};
  socket.onclose=()=>{setTransport(false);socket=null;if(!disposed)reconnectTimer=setTimeout(connect,2500)};
  socket.onerror=()=>socket?.close();
}
export function initChats(){
  disposed=false;connect();wireChatCopy($("#chatConversation"));
  $("#chatPrev")?.addEventListener("click",()=>void changePage(page-1));
  $("#chatNext")?.addEventListener("click",()=>void changePage(page+1));
  document.addEventListener("portfolio:server-status",e=>{if(e.detail?.online)connect()});
  void loadChats().catch(()=>{});
}
export function cleanupChats(){disposed=true;clearTimeout(reconnectTimer);socket?.close();socket=null}
