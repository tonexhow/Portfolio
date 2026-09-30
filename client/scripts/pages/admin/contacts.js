import {$,escapeHTML,formatDate,debounce,setEmpty,confirmAction,openModal,closeModal} from "./helpers.js";
let page=1,pages=1,loaded=false;
let contactItems=new Map();

function updateUnreadBadge(count){
  document.dispatchEvent(new CustomEvent("admin:contact-unread",{detail:{count:Number(count)||0}}));
}

function initials(name){
  return String(name||"?").split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]?.toUpperCase()||"").join("")||"?";
}

function renderItem(item){
  const unread=item.status==="new";
  const avatar=item.avatar_url?`<img src="${escapeHTML(window.PublicStore.apiURL(item.avatar_url))}?v=${encodeURIComponent(item.id)}" alt="" loading="lazy" data-contact-avatar>`:`<b>${escapeHTML(initials(item.full_name))}</b>`;
  return `<article class="management-record contact-record ${unread?"unread":""}">
    <div class="contact-record-layout">
      <div class="contact-record-avatar">${avatar}</div>
      <div class="contact-record-identity">
        <div class="contact-record-name-line"><h3>${escapeHTML(item.full_name)}</h3><div class="contact-record-tags"><span class="contact-verified-tag">Verified Gmail</span><span class="record-status ${escapeHTML(item.status)}">${unread?"unread":escapeHTML(item.status)}</span></div></div>
        <div class="contact-record-subject-row"><strong>${escapeHTML(item.subject)}</strong><div class="record-actions">
          <button class="record-action primary" data-contact-action="reply" data-contact-id="${item.id}">REPLY</button>
          ${unread?`<button class="record-action" data-contact-action="read" data-contact-id="${item.id}">Read</button>`:""}
          <button class="record-action danger" data-contact-action="delete" data-contact-id="${item.id}">Delete</button>
        </div></div>
      </div>
      <p class="contact-record-message">${escapeHTML(item.message)}</p>
      <div class="record-meta contact-record-meta"><a href="mailto:${escapeHTML(item.email)}">${escapeHTML(item.email)}</a><span>${formatDate(item.created_at)}</span><span>#${item.id}</span></div>
    </div>
  </article>`;
}

async function load(target=page){
  const root=$("#contactRecords");
  root.innerHTML=`<div class="inline-loading"><span class="spinner" aria-hidden="true"></span><span>Loading messages…</span></div>`;
  try{
    const data=await window.APIManager.getAdminContacts({page:target,status:$("#contactStatusFilter").value,q:$("#contactSearch").value.trim()});
    page=Number(data.page||1);pages=Math.max(1,Number(data.total_pages||1));loaded=true;
    const items=data.items||[];
    contactItems=new Map(items.map(item=>[String(item.id),item]));
    updateUnreadBadge(data.unread_total);
    if(!items.length)setEmpty(root,"No contact messages match this view.");
    else {
      root.innerHTML=items.map(renderItem).join("");
      root.querySelectorAll("img[data-contact-avatar]").forEach(image=>image.addEventListener("error",()=>{
        const holder=image.closest(".contact-record-avatar");
        const item=contactItems.get(String(image.closest(".contact-record")?.querySelector("[data-contact-id]")?.dataset.contactId||""));
        if(holder){ image.remove(); if(!holder.textContent.trim()) holder.innerHTML=`<b>${escapeHTML(initials(item?.full_name||"?"))}</b>`; }
      },{once:true}));
    }
    $("#contactPage").textContent=`Page ${page} of ${pages} · ${data.total||0} records`;
    $("#contactPrev").disabled=page<=1;$("#contactNext").disabled=page>=pages;
  }catch(error){setEmpty(root,error.message);window.UI.toast(error.message,{title:"Contact",type:"error"})}
}

function openReply(item){
  if(!item)return;
  $("#contactReplyId").value=item.id;
  $("#contactReplyName").textContent=item.full_name||"Contact";
  $("#contactReplyEmail").textContent=item.email||"No email";
  $("#contactReplyOriginalSubject").textContent=item.subject||"No subject";
  $("#contactReplyOriginalMessage").textContent=item.message||"";
  $("#contactReplySubject").value=/^re:/i.test(String(item.subject||"").trim())?item.subject:`Re: ${item.subject||"Portfolio inquiry"}`;
  $("#contactReplyMessage").value="";
  openModal("contactReplyModal");
  requestAnimationFrame(()=>$("#contactReplyMessage")?.focus());
}

async function sendReply(event){
  event.preventDefault();
  const id=$("#contactReplyId").value;
  const button=$("#sendContactReply");
  const payload={subject:$("#contactReplySubject").value.trim(),message:$("#contactReplyMessage").value.trim()};
  if(!payload.message){$("#contactReplyMessage").focus();return}
  window.UI.setButtonLoading(button,true,"Sending");
  try{
    const result=await window.APIManager.replyAdminContact(id,payload);
    window.UI.toast(result.message,{title:"Reply sent"});
    closeModal("contactReplyModal");
    await load(page);
    document.dispatchEvent(new CustomEvent("admin:overview-dirty"));
  }catch(error){
    window.UI.toast(error.message,{title:"Reply not sent",type:"error"});
  }finally{
    window.UI.setButtonLoading(button,false);
  }
}

async function handleAction(button){
  const id=button.dataset.contactId;
  const action=button.dataset.contactAction;
  if(action==="reply"){
    openReply(contactItems.get(String(id)));
    return;
  }
  button.disabled=true;
  try{
    if(action==="read"){
      await window.APIManager.updateAdminContact(id,"read");
      window.UI.toast("Message marked as read.",{title:"Contact"});
    }else if(action==="delete"){
      const confirmed=await confirmAction({title:"Delete contact message?",message:"This message will be permanently removed from the contact inbox.",confirmLabel:"Delete message"});
      if(!confirmed){button.disabled=false;return}
      await window.APIManager.deleteAdminContact(id);
      window.UI.toast("Contact message deleted.",{title:"Contact"});
    }
    await load(page);
    document.dispatchEvent(new CustomEvent("admin:overview-dirty"));
  }catch(error){
    window.UI.toast(error.message,{title:"Contact",type:"error"});
    button.disabled=false;
  }
}

export function initContacts(){
  $("#contactPrev").addEventListener("click",()=>page>1&&load(page-1));
  $("#contactNext").addEventListener("click",()=>page<pages&&load(page+1));
  $("#contactStatusFilter").addEventListener("change",()=>{page=1;load(1)});
  $("#contactSearch").addEventListener("input",debounce(()=>{page=1;load(1)},300));
  $("#contactRecords").addEventListener("click",e=>{
    const button=e.target.closest("[data-contact-action]");
    if(button)handleAction(button);
  });
  $("#contactReplyForm").addEventListener("submit",sendReply);
}
export function loadContacts(force=false){if(!loaded||force)return load(page)}
