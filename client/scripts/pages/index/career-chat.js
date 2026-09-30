const $ = s => document.querySelector(s);
let chatSocket=null,statusTimer=null,chatStarted=false,ownerName="Jhon Anthony Pano",closeTimer=null;
function escapeText(v){const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML}
function docLabel(type){return type==="cv"?"Curriculum Vitae":type==="biodata"?"Biodata":"Resume"}
function renderCareer(items){
  const list=$("#careerProfileList"); if(!list)return;
  if(!items?.length){list.innerHTML='<div class="empty-state">No Career Profile documents are published yet.</div>';return}
  list.innerHTML=items.map(x=>`<article class="career-doc"><div class="career-doc-icon">${x.document_type==="cv"?"CV":x.document_type==="biodata"?"BIO":"R"}</div><div><h3>${escapeText(x.title||docLabel(x.document_type))}</h3><p>${escapeText(x.description||docLabel(x.document_type))}</p><small>${escapeText(docLabel(x.document_type))} · Updated ${new Date(x.updated_at).toLocaleDateString()}</small></div><div class="career-doc-actions"><a href="${escapeText(x.storage_url)}" target="_blank" rel="noopener">Preview</a><a class="primary" href="${escapeText(x.storage_url)}?download" download>Download</a></div></article>`).join("");
}
export function initCareerProfile(){
  const modal=$("#careerProfileModal"),open=$("#careerProfileButton"),close=$("#careerProfileClose"); if(!modal||!open)return;
  const refresh=async()=>{const data=await window.PublicStore.init();renderCareer(data.career_profiles||[])};
  open.addEventListener("click",async()=>{await refresh();modal.showModal()});
  close?.addEventListener("click",()=>modal.close());
  modal.addEventListener("click",e=>{if(e.target===modal)modal.close()});
  document.addEventListener("portfolio:content-updated",refresh);
}
function addMessage(m){
  const box=$("#liveChatMessages");if(!box||!m)return;
  if(box.querySelector(`[data-chat-id="${CSS.escape(String(m.id))}"]`))return;
  const el=document.createElement("div");el.className=`chat-bubble ${m.sender}`;el.dataset.chatId=m.id;
  el.innerHTML=`${escapeText(m.body)}<time>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time>`;
  box.append(el);box.scrollTop=box.scrollHeight;
}
function panelIsOpen(){return !$("#liveChatPanel")?.hidden}
function closeChat(){
  const panel=$("#liveChatPanel"),launcher=$("#liveChatLauncher");if(!panel||panel.hidden)return;
  clearTimeout(closeTimer);panel.classList.remove("is-open");launcher?.classList.remove("is-open");launcher?.setAttribute("aria-expanded","false");
  closeTimer=setTimeout(()=>{panel.hidden=true},190);
}
function revealChat(){
  const panel=$("#liveChatPanel"),launcher=$("#liveChatLauncher");if(!panel)return;
  clearTimeout(closeTimer);panel.hidden=false;launcher?.setAttribute("aria-expanded","true");
  requestAnimationFrame(()=>{panel.classList.add("is-open");launcher?.classList.add("is-open")});
}
function setAvailable(ok){
  const b=$("#liveChatLauncher");if(!b)return;
  b.disabled=!ok&&!panelIsOpen();b.dataset.online=String(!!ok);
  b.title=ok?`Chat with ${ownerName}`:`${ownerName} is offline`;
  b.setAttribute("aria-label",b.title);
  const state=$("#liveChatState");if(state)state.textContent=ok?`${ownerName} is online`:`${ownerName} is offline`;
  const input=$("#liveChatInput"),send=$("#liveChatForm button");if(input)input.disabled=!ok;if(send)send.disabled=!ok;
  if(!ok&&chatSocket){chatSocket.close();chatSocket=null}
}
async function checkStatus(){
  try{const s=await window.APIManager.getChatStatus();setAvailable(!!s.available)}catch{setAvailable(false)}
}
async function openChat(){
  if(panelIsOpen()){closeChat();return}
  revealChat();
  try{
    const session=await window.APIManager.openChatSession();
    $("#liveChatMessages")?.querySelectorAll(".chat-bubble").forEach(n=>n.remove());
    (session.messages||[]).forEach(addMessage);connectChat();setAvailable(true);
    setTimeout(()=>$("#liveChatInput")?.focus(),210);
  }catch(e){setAvailable(false);window.UI.toast(e.message,{title:"Live chat",type:"error"})}
}
function connectChat(){
  if(chatSocket&&chatSocket.readyState<2)return;
  const ws=new WebSocket(window.APIManager.chatWebSocketURL("/api/public/chat/ws"));chatSocket=ws;
  ws.onmessage=e=>{try{const x=JSON.parse(e.data);if(x.type==="message")addMessage(x.message);if(x.type==="availability")setAvailable(x.available);if(x.type==="error")window.UI.toast(x.message||"Unable to send message.",{title:"Live chat",type:"error"});if(x.type==="closed"){$("#liveChatState").textContent="Conversation closed"}}catch{}};
  ws.onclose=()=>{if(chatSocket===ws)chatSocket=null};
}
function submitChat(){
  const input=$("#liveChatInput");const body=input?.value.trim();
  if(!body||!chatSocket||chatSocket.readyState!==WebSocket.OPEN)return false;
  chatSocket.send(JSON.stringify({body}));input.value="";input.dispatchEvent(new Event("input"));return true;
}
export function initLiveChat(){
  if(chatStarted)return;chatStarted=true;
  void window.PublicStore.init().then(data=>{ownerName=data?.information?.name?.full||ownerName;void checkStatus()}).catch(()=>{});
  const launcher=$("#liveChatLauncher"),form=$("#liveChatForm"),input=$("#liveChatInput");
  launcher?.setAttribute("aria-expanded","false");launcher?.addEventListener("click",openChat);
  $("#liveChatClose")?.addEventListener("click",closeChat);
  form?.addEventListener("submit",e=>{e.preventDefault();submitChat()});
  input?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();form?.requestSubmit()}});
  void checkStatus();statusTimer=setInterval(checkStatus,15000);document.addEventListener("portfolio:server-status",checkStatus);
}
export function cleanupCareerChat(){clearInterval(statusTimer);clearTimeout(closeTimer);chatSocket?.close();chatSocket=null}
