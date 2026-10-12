import {$,escapeHTML,confirmAction} from "./helpers.js";

let items=[], selected="", socket=null, reconnectTimer=null;
let page=1, totalPages=1, totalItems=0, unreadTotal=0, heightObserver=null;

function wsURL(){return window.APIManager.chatWebSocketURL("/api/admin/chat/ws")}
function apiURL(path){return path?window.APIManager.apiURL(path):""}
function setTransport(live){
  const el=$("#chatTransportState");
  el?.classList.toggle("live",live);
  if(el)el.innerHTML=`<i></i>${live?"Live connection":"Reconnecting…"}`;
}
function setUnread(n){
  const b=$("#chatUnreadBadge"); if(!b)return;
  n=Math.max(0,Number(n)||0); b.textContent=n>99?"99+":String(n); b.hidden=!n;
}
function shortThread(id=""){return id.replace(/^chat_/,"#")}
function avatarHTML(x, size="table"){
  if(x?.visitor_avatar_url){
    return `<img class="chat-identity-avatar ${size}" src="${escapeHTML(apiURL(x.visitor_avatar_url))}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  }
  const initial=(x?.visitor_auth_name||"A").trim().slice(0,1).toUpperCase()||"A";
  return `<span class="chat-identity-avatar placeholder ${size}" aria-hidden="true">${escapeHTML(initial)}</span>`;
}
function identityHTML(x){
  const name=x.visitor_auth_name||"Anonymous visitor";
  const detail=x.visitor_auth_provider ? `${x.visitor_auth_provider}${x.visitor_auth_credential?` · ${x.visitor_auth_credential}`:""}` : "Not signed in with OAuth";
  return `<div class="chat-identity-cell">${avatarHTML(x)}<span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(detail)}</small></span></div>`;
}
function agentHTML(x){
  const agent=x.visitor_agent||"Unknown browser";
  const platform=x.visitor_platform||"Unknown device";
  const country=x.visitor_country?` · ${x.visitor_country}`:"";
  return `<div class="chat-agent-cell" title="${escapeHTML(x.visitor_user_agent||agent)}"><strong>${escapeHTML(agent)}</strong><small>${escapeHTML(platform+country)}</small></div>`;
}
function renderTable(){
  const body=$("#chatTableBody"); if(!body)return;
  if(!items.length){body.innerHTML='<tr><td colspan="8" class="chat-table-empty">No live-chat conversations on this page.</td></tr>';syncChatPanelHeight();return}
  body.innerHTML=items.map(x=>`<tr data-id="${escapeHTML(x.id)}" class="${x.id===selected?'active':''}">
    <td class="chat-thread-cell"><strong>${escapeHTML(shortThread(x.id))}</strong>${x.admin_unread?`<span class="chat-unread">${x.admin_unread}</span>`:""}</td>
    <td>${identityHTML(x)}</td>
    <td>${agentHTML(x)}</td>
    <td><code class="chat-network-value">${escapeHTML(x.visitor_ip||"—")}</code></td>
    <td><code class="chat-fingerprint" title="IP hash: ${escapeHTML(x.visitor_ip_hash||"not available")}">${escapeHTML(x.visitor_fingerprint||"—")}</code></td>
    <td class="chat-last-message">${escapeHTML((x.last_sender?`${x.last_sender}: `:"")+(x.last_message||"No messages yet"))}</td>
    <td><span class="chat-status ${escapeHTML(x.status)}">${escapeHTML(x.status)}</span></td>
    <td class="chat-updated">${new Date(x.last_message_at).toLocaleString()}</td>
  </tr>`).join("");
  body.querySelectorAll("tr[data-id]").forEach(r=>r.addEventListener("click",()=>openThread(r.dataset.id)));
  syncChatPanelHeight();
}
function renderPagination(){
  const label=$("#chatPage"), prev=$("#chatPrev"), next=$("#chatNext"), wrap=$("#chatPagination");
  if(label)label.textContent=`Page ${page} of ${totalPages} · ${totalItems} chat${totalItems===1?"":"s"}`;
  if(prev)prev.disabled=page<=1;
  if(next)next.disabled=page>=totalPages;
  if(wrap)wrap.hidden=totalItems===0;
  syncChatPanelHeight();
}
function clearConversation(){
  selected="";
  const panel=$("#chatConversation");
  if(panel)panel.innerHTML='<div class="chat-conversation-empty">Select a conversation to view messages.</div>';
  renderTable();
}
async function changePage(nextPage){
  const target=Math.min(Math.max(1,nextPage),totalPages);
  if(target===page)return;
  page=target;
  clearConversation();
  await loadChats();
}
export async function loadChats(){
  const data=await window.APIManager.getAdminChats(page);
  page=Math.max(1,Number(data.page)||1);
  totalPages=Math.max(1,Number(data.total_pages)||1);
  totalItems=Math.max(0,Number(data.total_items)||0);
  items=data.items||[];
  unreadTotal=Math.max(0,Number(data.unread)||0);
  setUnread(unreadTotal);
  renderTable();
  renderPagination();
}

function bubble(m){
  return `<div class="admin-chat-bubble ${m.sender}" data-id="${escapeHTML(String(m.id||""))}">${escapeHTML(m.body)}<small>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></div>`;
}
function detailValue(value,fallback="Not available"){return escapeHTML(value||fallback)}
function threadHead(x){
  const name=x?.visitor_auth_name||"Anonymous visitor";
  const oauth=x?.visitor_auth_provider ? `${x.visitor_auth_provider}${x.visitor_auth_credential?` · ${x.visitor_auth_credential}`:""}` : "No OAuth identity";
  return `<div class="chat-conversation-head">
    <div class="chat-thread-profile">
      ${avatarHTML(x,"detail")}
      <div><span class="chat-thread-kicker">${escapeHTML(shortThread(x?.id||selected))}</span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(oauth)}</small></div>
    </div>
    <button type="button" id="deleteChatButton" class="icon-button" title="Delete chat" aria-label="Delete chat">×</button>
  </div>
  <div class="chat-thread-meta" aria-label="Visitor connection details">
    <span><b>Agent</b>${detailValue(x?.visitor_agent)}</span>
    <span><b>Device</b>${detailValue(x?.visitor_platform)}</span>
    <span><b>IP</b><code>${detailValue(x?.visitor_ip)}</code></span>
    <span><b>Country</b>${detailValue(x?.visitor_country,"Local / unavailable")}</span>
    <span><b>Fingerprint</b><code>${detailValue(x?.visitor_fingerprint)}</code></span>
    <span class="wide" title="${escapeHTML(x?.visitor_user_agent||"")}"><b>User agent</b>${detailValue(x?.visitor_user_agent)}</span>
  </div>`;
}

async function openThread(id){
  selected=id; renderTable();
  try{
    const data=await window.APIManager.getAdminChatMessages(id);
    const x=data.thread||items.find(v=>v.id===id)||{id};
    const panel=$("#chatConversation");
    panel.innerHTML=`${threadHead(x)}<div class="chat-conversation-messages" id="adminChatMessages">${(data.messages||[]).map(bubble).join("")||'<div class="admin-empty">No messages yet.</div>'}</div><form class="chat-admin-form" id="adminChatForm"><textarea id="adminChatInput" rows="1" maxlength="2000" placeholder="Reply…" autocomplete="off" required></textarea><button type="submit">Send</button></form>`;
    const form=panel.querySelector("#adminChatForm"), input=$("#adminChatInput");
    const send=()=>{
      const body=input.value.trim();
      if(!body||!socket||socket.readyState!==WebSocket.OPEN){window.UI.toast("Live connection is not ready.",{title:"Chats",type:"error"});return}
      socket.send(JSON.stringify({action:"send",thread_id:selected,body})); input.value="";
    };
    form?.addEventListener("submit",e=>{e.preventDefault();send()});
    input?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form?.requestSubmit()}});
    panel.querySelector("#deleteChatButton")?.addEventListener("click",async()=>{
      const ok=await confirmAction({title:"Delete conversation?",message:"This removes the chat and its retained visitor metadata immediately.",confirmLabel:"Delete chat"});
      if(!ok)return;
      await window.APIManager.deleteAdminChat(selected); clearConversation(); await loadChats();
    });
    const readCount=Number(items.find(v=>v.id===id)?.admin_unread)||0;
    unreadTotal=Math.max(0,unreadTotal-readCount);
    items=items.map(v=>v.id===id?{...v,admin_unread:0}:v); setUnread(unreadTotal); renderTable(); scrollMessages(); syncChatPanelHeight();
  }catch(e){window.UI.toast(e.message,{title:"Chats",type:"error"})}
}
function scrollMessages(){const box=$("#adminChatMessages");if(box)box.scrollTop=box.scrollHeight}
function handleEvent(x){
  if(x.type==="message"){
    void loadChats();
    if(x.message?.thread_id===selected){
      const box=$("#adminChatMessages"); box?.querySelector(".admin-empty")?.remove();
      if(box&&!box.querySelector(`[data-id="${CSS.escape(String(x.message.id))}"]`)){box.insertAdjacentHTML("beforeend",bubble(x.message));scrollMessages()}
    }
  }else if(x.type==="thread")void loadChats();
}
function connect(){
  clearTimeout(reconnectTimer); if(socket&&socket.readyState<2)return;
  try{socket=new WebSocket(wsURL())}catch{return}
  socket.onopen=()=>setTransport(true);
  socket.onmessage=e=>{try{handleEvent(JSON.parse(e.data))}catch{}};
  socket.onclose=()=>{setTransport(false);socket=null;reconnectTimer=setTimeout(connect,2500)};
  socket.onerror=()=>socket?.close();
}
function syncChatPanelHeight(){
  const list=$(".chat-list-panel"), conversation=$("#chatConversation");
  if(!list||!conversation)return;
  if(matchMedia("(max-width: 980px)").matches){conversation.style.height="";return}
  const h=Math.max(520,Math.ceil(list.getBoundingClientRect().height));
  conversation.style.height=`${h}px`;
}
function installHeightSync(){
  heightObserver?.disconnect();
  const list=$(".chat-list-panel");
  if(list&&"ResizeObserver" in window){heightObserver=new ResizeObserver(syncChatPanelHeight);heightObserver.observe(list)}
  addEventListener("resize",syncChatPanelHeight,{passive:true});
  syncChatPanelHeight();
}
export function initChats(){
  connect();
  $("#chatPrev")?.addEventListener("click",()=>void changePage(page-1));
  $("#chatNext")?.addEventListener("click",()=>void changePage(page+1));
  document.addEventListener("portfolio:server-status",e=>{if(e.detail?.online)connect()});
  installHeightSync();
  void loadChats().catch(()=>{});
}
export function cleanupChats(){clearTimeout(reconnectTimer);heightObserver?.disconnect();heightObserver=null;socket?.close();socket=null}
