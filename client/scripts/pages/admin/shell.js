import {$,$$,openModal,closeModal} from "./helpers.js";

export function initShell(onView){
  window.UI.Theme.init();

  const unreadBadge=$("#contactUnreadBadge");
  const setUnread=count=>{
    const value=Math.max(0,Number(count)||0);
    if(!unreadBadge)return;
    unreadBadge.textContent=value>99?"99+":String(value);
    unreadBadge.hidden=value<=0;
  };
  document.addEventListener("admin:contact-unread",event=>setUnread(event.detail?.count));
  window.APIManager.getAdminOverview().then(data=>setUnread(data.contacts?.new)).catch(()=>{});

  const dateEl=$("#adminDate"), timeEl=$("#adminTime");
  const tick=()=>{
    const now=new Date();
    dateEl.textContent=new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(now);
    timeEl.textContent=new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(now);
  };
  tick(); setInterval(tick,1000);

  let expiresAt=0;
  const sessionEl=$("#sessionRemaining");
  const sessionTick=()=>{
    if(!expiresAt)return;
    const diff=Math.max(0,expiresAt-Date.now());
    const total=Math.floor(diff/1000);
    const h=String(Math.floor(total/3600)).padStart(2,"0");
    const m=String(Math.floor((total%3600)/60)).padStart(2,"0");
    const s=String(total%60).padStart(2,"0");
    sessionEl.textContent=`${h}:${m}:${s}`;
    if(diff<=0) location.replace("/access");
  };
  const checkSession=()=>window.APIManager.getAccessSession().then(session=>{
    if(!session.authorized){location.replace("/access");return}
    expiresAt=new Date(session.expires_at).getTime(); sessionTick();
  }).catch(()=>{sessionEl.textContent="Server offline";});
  void checkSession();
  document.addEventListener("portfolio:server-status", event=>{if(event.detail.ready){void checkSession();onView?.((location.hash||"#overview").slice(1),false);}});
  setInterval(sessionTick,1000);

  let activeView=(location.hash||"#overview").slice(1), syncTimer;
  document.addEventListener("portfolio:content-updated",event=>{
    if(window.ServerStatus?.ready!==true||activeView==="information"||event.detail?.source==="connection")return;
    clearTimeout(syncTimer);
    syncTimer=setTimeout(()=>{
      // Do not reset a gallery editor, a confirmation, or an active drag operation.
      if(document.querySelector(".modal-backdrop:not([hidden]),.project-management-card.dragging"))return;
      onView?.(activeView,true);
    },250);
  });
  const activate=name=>{
    activeView=name;
    $$(".admin-view").forEach(v=>v.classList.toggle("active",v.dataset.view===name));
    $$("[data-admin-view]").forEach(b=>b.classList.toggle("active",b.dataset.adminView===name));
    history.replaceState(null,"",`#${name}`);
    document.querySelector(".management-main")?.scrollTo?.({top:0});
    scrollTo({top:0,behavior:"auto"});
    onView?.(name);
  };
  $$("[data-admin-view]").forEach(b=>b.addEventListener("click",()=>activate(b.dataset.adminView)));
  const initial=(location.hash||"#overview").slice(1);
  activate(["overview","dashboard","feedbacks","contacts","certificates","projects","career","chats","information"].includes(initial)?initial:"overview");

  $("#endSessionButton")?.addEventListener("click",()=>openModal("endSessionModal"));
  $$("[data-close-modal]").forEach(b=>b.addEventListener("click",()=>closeModal(b.dataset.closeModal)));
  $$(".modal-backdrop").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)closeModal(m.id)}));
  document.addEventListener("keydown",e=>{if(e.key==="Escape")$$(".modal-backdrop:not([hidden])").forEach(m=>closeModal(m.id))});

  $("#confirmEndSession")?.addEventListener("click",async()=>{
    const button=$("#confirmEndSession");window.UI.setButtonLoading(button,true,"Ending…");
    try{await window.APIManager.logoutManagement();location.replace("/access")}
    catch(error){window.UI.toast(error.message,{title:"Session",type:"error"});window.UI.setButtonLoading(button,false)}
  });

  document.addEventListener("click",e=>{
    const b=e.target.closest("[data-refresh-view]");
    if(b) onView?.(b.dataset.refreshView,true);
  });
}
