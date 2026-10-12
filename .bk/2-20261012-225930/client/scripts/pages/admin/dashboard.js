import {$,formatNumber,setEmpty} from "./helpers.js";
import {drawLineChart,drawBarChart} from "./charts.js";

let loaded=false,lastData=null;

const METRIC_ICONS=[
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5z"/><path d="M8 2v4M16 2v4M5 9h14"/><path d="M9 13h2M13 13h2M9 17h2"/></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v15H4z"/><path d="M8 3v4M16 3v4M4 9h16"/><path d="M8 13h3M13 13h3M8 17h3"/></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6Z"/><circle cx="12" cy="12" r="2.5"/></svg>`,
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 20v-1.5a4.5 4.5 0 0 0-4.5-4.5h-3A4.5 4.5 0 0 0 4 18.5V20"/><circle cx="10" cy="7" r="4"/><path d="M17 8h4M19 6v4"/></svg>`
];

function render(data){
  lastData=data;
  const s=data.summary;
  const cards=[
    ["Today",s.today,"Visits since midnight"],
    ["This month",s.month,"Current month"],
    ["All visits",s.total,"Recorded page views"],
    ["Unique",s.unique,"Hashed visitors"]
  ];
  $("#dashboardMetrics").innerHTML=cards.map((x,i)=>`<article class="metric-card"><span class="metric-icon">${METRIC_ICONS[i]}</span><div><small>${x[0]}</small><strong>${formatNumber(x[1])}</strong><span>${x[2]}</span></div></article>`).join("");
  drawLineChart($("#dailyVisitsChart"),data.daily||[]);
  drawBarChart($("#monthlyVisitsChart"),data.monthly||[]);
  const table=$("#dailyVisitsTable");
  if(data.daily?.length)table.innerHTML=[...data.daily].reverse().map(p=>`<div class="analytics-row"><span>${p.label}</span><strong>${formatNumber(p.value)}</strong></div>`).join("");
  else setEmpty(table,"No visitor data yet.");
}

export async function loadDashboard(force=false){
  if(loaded&&!force){if(lastData)requestAnimationFrame(()=>render(lastData));return}
  try{const data=await window.APIManager.getAdminAnalytics();loaded=true;render(data)}
  catch(error){window.UI.toast(error.message,{title:"Dashboard",type:"error"})}
}

export function initDashboard(){
  let timer;
  addEventListener("resize",()=>{clearTimeout(timer);timer=setTimeout(()=>{if(lastData&&document.querySelector("#view-dashboard.active"))render(lastData)},150)},{passive:true});
  matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change",()=>{if(lastData)render(lastData)});
  document.querySelectorAll("[data-theme-option]").forEach(b=>b.addEventListener("click",()=>setTimeout(()=>lastData&&render(lastData),30)));
  document.querySelector("#adminThemeTiny")?.addEventListener("click",()=>setTimeout(()=>lastData&&render(lastData),30));
}
