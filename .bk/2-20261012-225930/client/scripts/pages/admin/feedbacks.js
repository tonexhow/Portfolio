import {$,escapeHTML,formatDate,debounce,setEmpty,confirmAction} from "./helpers.js";
let page=1,pages=1,loaded=false,privacyMasked=true,lastItems=[];

function providerLabel(provider){return ({google:"Google",github:"GitHub",facebook:"Facebook",telegram:"Telegram",legacy:"Legacy"})[provider]||"Verified"}
function providerIcon(provider){
  const icons={
    google:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.4 12.2c0-.7-.1-1.3-.2-1.9H12v3.6h4.7a4 4 0 0 1-1.7 2.6v2.2h2.8c1.7-1.5 2.6-3.8 2.6-6.5Z"/><path d="M12 20.7c2.4 0 4.4-.8 5.8-2.1L15 16.4c-.8.5-1.8.9-3 .9a5.2 5.2 0 0 1-4.9-3.6H4.2V16A8.8 8.8 0 0 0 12 20.7Z"/><path d="M7.1 13.7a5.3 5.3 0 0 1 0-3.4V8H4.2a8.8 8.8 0 0 0 0 8l2.9-2.3Z"/><path d="M12 6.7c1.3 0 2.5.5 3.4 1.3l2.5-2.5A8.5 8.5 0 0 0 4.2 8l2.9 2.3A5.2 5.2 0 0 1 12 6.7Z"/></svg>`,
    github:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.7a9.5 9.5 0 0 0-3 18.5c.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.5-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 0 1.5 1 1.5 1 .9 1.5 2.3 1.1 2.9.8.1-.7.3-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-4.7 0-1 .4-1.9 1-2.6-.1-.3-.4-1.3.1-2.6 0 0 .8-.3 2.7 1a9.2 9.2 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .5 1.3.2 2.3.1 2.6.7.7 1 1.6 1 2.6 0 3.6-2.4 4.4-4.6 4.7.4.3.7.9.7 1.7v2.6c0 .3.2.6.7.5A9.5 9.5 0 0 0 12 2.7Z"/></svg>`,
    facebook:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.7 21v-8h2.7l.4-3h-3.1V8.1c0-.9.3-1.5 1.6-1.5H17V3.9c-.3 0-1.3-.1-2.4-.1-2.4 0-4 1.4-4 4.1V10H8v3h2.6v8h3.1Z"/></svg>`,
    telegram:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21 4-3.1 15.1c-.2 1.1-.9 1.4-1.8.9l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.3-4.8L17.2 6c.4-.3-.1-.5-.6-.2L5.8 12.6 1.2 11c-1-.3-1-1 .2-1.5l18-6.9c.8-.3 1.6.2 1.6 1.4Z"/></svg>`
  };return icons[provider]||`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/></svg>`;
}
function initials(name){return String(name||"?").split(/\s+/).filter(Boolean).slice(0,2).map(v=>v[0]?.toUpperCase()||"").join("")||"?"}
function maskName(name){return String(name||"").split(/\s+/).filter(Boolean).map(part=>{const chars=[...part];return chars.length<=1?"*":chars[0]+"*".repeat(Math.min(6,Math.max(2,chars.length-1)))}).join(" ")}
function maskCredential(value){
  const text=String(value||"").trim();if(!text)return "";
  const at=text.indexOf("@");
  if(at>0&&text.slice(at+1).includes(".")){const [local,domain]=[text.slice(0,at),text.slice(at+1)];const parts=domain.split(".");return `${local[0]}***@${parts[0]?.[0]||"*"}***${parts.length>1?`.${parts.slice(1).join(".")}`:""}`}
  if(text.startsWith("@")){const user=text.slice(1);return `@${user[0]||"*"}${"*".repeat(Math.min(6,Math.max(3,user.length-1)))}`}
  if(/ ID /i.test(text)){return text.replace(/(ID\s+).*(.{3})$/i,"$1***$2")}
  return text[0]+"*".repeat(Math.min(8,Math.max(3,text.length-1)));
}

function renderActions(item){
  if(item.status==="pending"){
    return `<button class="record-action primary" data-feedback-action="accept" data-feedback-id="${item.id}">Accept</button>
      <button class="record-action danger" data-feedback-action="delete" data-feedback-id="${item.id}">Delete</button>`;
  }
  const displayed=item.status==="approved";
  return `<button class="record-action ${item.pinned?"primary":""}" data-feedback-action="pin" data-feedback-id="${item.id}" data-feedback-pinned="${item.pinned?"false":"true"}">${item.pinned?"Unpin":"Pin"}</button>
    <button class="record-action ${displayed?"primary":""}" data-feedback-action="visibility" data-feedback-id="${item.id}" data-feedback-status="${displayed?"hidden":"approved"}">${displayed?"Hide":"Display"}</button>
    <button class="record-action danger" data-feedback-action="delete" data-feedback-id="${item.id}">Delete</button>`;
}

function renderItem(item){
  const statusLabel=item.status==="pending"?"Awaiting review":item.status==="approved"?"Displayed":"Hidden";
  const name=privacyMasked?maskName(item.display_name):item.display_name;
  const credential=privacyMasked?maskCredential(item.credential):item.credential;
  const provider=item.auth_provider||"legacy";
  return `<article class="management-record feedback-record ${item.pinned?"pinned":""}">
    <div class="record-main">
      <span class="record-avatar"><b>${escapeHTML(initials(item.display_name))}</b>${item.avatar_url?`<img data-feedback-avatar src="${escapeHTML(window.PublicStore.apiURL(item.avatar_url))}" alt="">`:""}</span>
      <div class="record-head">
        <div class="record-person">
          <div class="record-person-line"><h3>${escapeHTML(name)}</h3>${provider!=="legacy"?`<span class="record-provider" title="${escapeHTML(providerLabel(provider))}">${providerIcon(provider)}</span>`:""}</div>
          ${credential?`<small class="record-credential">${escapeHTML(credential)}</small>`:""}
          <div class="record-identity-tags">${item.pinned?`<span class="pin-label">Pinned</span>`:""}${provider!=="legacy"?`<span class="record-provider-label">${escapeHTML(providerLabel(provider))}</span>`:""}</div>
        </div>
        <span class="record-status ${escapeHTML(item.status)}">${statusLabel}</span>
      </div>
      <div class="record-rating">${"★".repeat(Number(item.rating)||0)}${"☆".repeat(Math.max(0,5-(Number(item.rating)||0)))}</div>
      <p class="record-comment">${escapeHTML(item.comment)}</p>
      <div class="record-meta"><span>${formatDate(item.created_at)}</span><span>#${item.id}</span></div>
    </div>
    <div class="record-actions">${renderActions(item)}</div>
  </article>`;
}

function renderItems(){
  const root=$("#feedbackRecords");
  if(!lastItems.length)setEmpty(root,"No feedback matches this view.");
  else{
    root.innerHTML=lastItems.map(renderItem).join("");
    root.querySelectorAll("img[data-feedback-avatar]").forEach(image=>image.addEventListener("error",()=>image.remove(),{once:true}));
  }
}

function syncPrivacyButton(){
  const button=$("#feedbackPrivacyToggle");
  if(!button)return;
  button.setAttribute("aria-pressed",String(!privacyMasked));
  button.title=privacyMasked?"Show full feedback identities":"Mask feedback identities";
  const label=button.querySelector("span");if(label)label.textContent=privacyMasked?"Unmask details":"Mask details";
}

async function load(target=page){
  const root=$("#feedbackRecords");
  root.innerHTML=`<div class="inline-loading"><span class="spinner" aria-hidden="true"></span><span>Loading feedback…</span></div>`;
  try{
    const data=await window.APIManager.getAdminFeedback({page:target,status:$("#feedbackStatusFilter").value,q:$("#feedbackSearch").value.trim()});
    page=Number(data.page||1);pages=Math.max(1,Number(data.total_pages||1));loaded=true;lastItems=data.items||[];
    renderItems();
    $("#feedbackPage").textContent=`Page ${page} of ${pages} · ${data.total||0} records`;
    $("#feedbackPrev").disabled=page<=1;$("#feedbackNext").disabled=page>=pages;
  }catch(error){lastItems=[];setEmpty(root,error.message);window.UI.toast(error.message,{title:"Feedbacks",type:"error"})}
}

async function handleAction(button){
  const id=button.dataset.feedbackId;
  const action=button.dataset.feedbackAction;
  button.disabled=true;
  try{
    if(action==="accept"){
      await window.APIManager.updateAdminFeedback(id,{status:"approved"});
      window.UI.toast("Feedback accepted and displayed.",{title:"Feedback"});
    }else if(action==="delete"){
      const confirmed=await confirmAction({title:"Delete feedback?",message:"This feedback and its verified identity reference will be permanently removed.",confirmLabel:"Delete feedback"});
      if(!confirmed){button.disabled=false;return}
      await window.APIManager.deleteAdminFeedback(id);
      window.UI.toast("Feedback deleted.",{title:"Feedback"});
    }else if(action==="visibility"){
      await window.APIManager.updateAdminFeedback(id,{status:button.dataset.feedbackStatus});
      window.UI.toast(button.dataset.feedbackStatus==="approved"?"Feedback displayed.":"Feedback hidden.",{title:"Feedback"});
    }else if(action==="pin"){
      await window.APIManager.updateAdminFeedback(id,{pinned:button.dataset.feedbackPinned==="true"});
      window.UI.toast(button.dataset.feedbackPinned==="true"?"Feedback pinned.":"Feedback unpinned.",{title:"Feedback"});
    }
    await load(page);
    document.dispatchEvent(new CustomEvent("admin:overview-dirty"));
  }catch(error){
    window.UI.toast(error.message,{title:"Feedback",type:"error"});
    button.disabled=false;
  }
}

export function initFeedbacks(){
  syncPrivacyButton();
  $("#feedbackPrivacyToggle").addEventListener("click",()=>{privacyMasked=!privacyMasked;syncPrivacyButton();renderItems()});
  $("#feedbackPrev").addEventListener("click",()=>page>1&&load(page-1));
  $("#feedbackNext").addEventListener("click",()=>page<pages&&load(page+1));
  $("#feedbackStatusFilter").addEventListener("change",()=>{page=1;load(1)});
  $("#feedbackSearch").addEventListener("input",debounce(()=>{page=1;load(1)},300));
  $("#feedbackRecords").addEventListener("click",e=>{
    const button=e.target.closest("[data-feedback-action]");
    if(button)handleAction(button);
  });
}
export function loadFeedbacks(force=false){if(!loaded||force)return load(page)}
