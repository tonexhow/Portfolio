import {$,escapeHTML,formatDate,formatNumber,setEmpty} from "./helpers.js";
let loaded=false;

const queueIcons={
  feedbacks:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v8Z"/><path d="m8 11 2 2 5-5"/></svg>`,
  contacts:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="m4 7 8 6 8-6"/></svg>`,
  projects:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h7l2 2h7v10H4z"/></svg>`,
  moderated:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 7.6 7 10 4.2-2.4 7-5.4 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>`
};

function updateUnreadBadge(count){
  document.dispatchEvent(new CustomEvent("admin:contact-unread",{detail:{count:Number(count)||0}}));
}

export async function loadOverview(force=false){
  if(loaded&&!force)return;
  const metrics=$("#overviewMetrics"), activity=$("#recentActivity"), queues=$("#overviewQueues");
  try{
    const data=await window.APIManager.getAdminOverview();loaded=true;
    updateUnreadBadge(data.contacts.new);
    const cards=[
      ["Visits today",data.visits.today,"Today"],
      ["This month",data.visits.month,"Page visits"],
      ["Total visits",data.visits.total,`${formatNumber(data.visits.unique)} unique`],
      ["Visible projects",data.projects.visible,`${data.projects.total} managed`]
    ];
    metrics.innerHTML=cards.map((c,i)=>`<article class="metric-card"><span class="metric-icon">${["↗","M","Σ","P"][i]}</span><div><small>${escapeHTML(c[0])}</small><strong>${formatNumber(c[1])}</strong><span>${escapeHTML(c[2])}</span></div></article>`).join("");

    if(data.recent?.length){
      activity.innerHTML=data.recent.map(item=>`<article class="activity-item"><span class="activity-kind">${item.kind==="feedback"?"★":"@"}</span><div class="activity-copy"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.detail)}</p><small>${escapeHTML(item.status)} · ${formatDate(item.created_at)}</small></div></article>`).join("");
    }else setEmpty(activity,"No portfolio interactions yet.");

    const q=[
      {label:"Pending feedback",value:data.feedback.pending,meta:"Needs review",view:"feedbacks",kind:"feedbacks"},
      {label:"New messages",value:data.contacts.new,meta:"Unread",view:"contacts",kind:"contacts"},
      {label:"Hidden feedback",value:data.feedback.hidden,meta:"Moderated",view:"feedbacks",kind:"moderated"},
      {label:"Managed projects",value:data.projects.total,meta:"Managed",view:"projects",kind:"projects"}
    ];
    queues.innerHTML=q.map(item=>`<button class="queue-tile ${item.kind}" type="button" data-admin-view="${item.view}">
      <span class="queue-icon">${queueIcons[item.kind]}</span>
      <span class="queue-copy"><small>${escapeHTML(item.label)}</small><strong>${formatNumber(item.value)}</strong><em>${escapeHTML(item.meta)}</em></span>
      <span class="queue-arrow">↗</span>
    </button>`).join("");
    queues.querySelectorAll("[data-admin-view]").forEach(b=>b.addEventListener("click",()=>document.querySelector(`.management-sidebar [data-admin-view="${b.dataset.adminView}"]`)?.click()));
  }catch(error){
    setEmpty(activity,error.message);
    window.UI.toast(error.message,{title:"Overview",type:"error"});
  }
}

document.addEventListener("admin:overview-dirty",()=>{loaded=false});
