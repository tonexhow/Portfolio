import {escapeHTML} from './helpers.js';
const $=s=>document.querySelector(s);
const fmtBytes=n=>{if(!Number.isFinite(Number(n))||Number(n)<=0)return 'Not reported';const units=['B','KB','MB','GB','TB'];let i=0;let v=Number(n);while(v>=1024&&i<units.length-1){v/=1024;i++}return `${v.toFixed(i?1:0)} ${units[i]}`};
const percent=n=>Math.min(100,Math.max(0,Number(n)||0));
const cpuPoints=[],ramPoints=[];
let monitor=null,serverBusy=false;
const historySize=36;
function record(points,value){points.push(percent(value));if(points.length>historySize)points.shift()}
function historySVG(points,desc){
 const w=280,h=64;
 const path=points.map((v,i)=>`${i?'L':'M'}${(i*w/Math.max(1,historySize-1)).toFixed(1)},${(h-4-(v/100)*(h-8)).toFixed(1)}`).join(' ');
 return `<svg class="resource-history" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${escapeHTML(desc)} history chart"><path d="M0 ${h-4}H${w}" class="history-grid"/><path d="${path}" class="history-line"/></svg>`;
}
function resourceCard(label,value,amount,subtitle,points){
 const number=Number(amount),usable=Number.isFinite(number)&&number>=0;
 return `<article class="admin-card resource-card"><div class="resource-card-head"><div><small>${escapeHTML(label)}</small><strong>${escapeHTML(value)}</strong></div><span class="resource-label">${usable?`${Math.round(number)}%`:'Sampling…'}</span></div>${historySVG(points,label)}<div class="resource-bar" role="progressbar" aria-label="${escapeHTML(label)} usage" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${usable?Math.round(number):0}"><span style="width:${usable?percent(number):0}%"></span></div><p>${escapeHTML(subtitle)}</p></article>`;
}
function rowInspector(){
 let modal=$('#adminDbRowsModal');if(modal)return modal;
 modal=document.createElement('dialog');modal.id='adminDbRowsModal';modal.className='admin-detail-dialog db-rows-modal';
 modal.innerHTML=`<div class="admin-detail-dialog-inner"><header><div><small>Read-only table inspector</small><h2 id="dbRowsTitle">Database rows</h2></div><button type="button" id="dbRowsClose" aria-label="Close table inspector">✕</button></header><p id="dbRowsNote" class="db-rows-note">Private fields are redacted. Showing 20 rows per page.</p><div class="db-rows-scroller" id="dbRowsContent"></div><footer class="db-rows-pagination"><button type="button" id="dbRowsPrev">← Previous</button><span id="dbRowsPage">Page 1</span><button type="button" id="dbRowsNext">Next →</button></footer></div>`;
 document.body.append(modal);modal.querySelector('#dbRowsClose').addEventListener('click',()=>modal.close());
 modal.addEventListener('click',e=>{if(e.target===modal)modal.close()});return modal;
}
let inspectState={schema:'',table:'',page:1};
async function inspectRows(schema,table,page=1){
 inspectState={schema,table,page};const dlg=rowInspector();
 dlg.querySelector('#dbRowsTitle').textContent=`${schema}.${table}`;
 if(!dlg.open)dlg.showModal();
 const content=dlg.querySelector('#dbRowsContent');content.textContent='Loading a safe preview of table rows…';
 try{
  const data=await window.APIManager.getDatabaseRows(schema,table,page);
  if(inspectState.schema!==schema||inspectState.table!==table||inspectState.page!==page||!dlg.open)return;
  const cols=data.columns||[],items=data.rows||[];
  if(!items.length){content.innerHTML='<p class="admin-empty">No rows on this page.</p>'}
  else{
   const tableEl=document.createElement('table');tableEl.className='admin-metadata-table';
   const head=document.createElement('thead'),top=document.createElement('tr');
   cols.forEach(c=>{const th=document.createElement('th');th.textContent=c.name; if(c.redacted)th.title='Sensitive content hidden';top.append(th)});
   head.append(top);tableEl.append(head);
   const body=document.createElement('tbody');for(const values of items){const row=document.createElement('tr');for(let i=0;i<cols.length;i++){
    const td=document.createElement('td');td.textContent=values[i]??'—';td.title=cols[i]?.redacted?'Sensitive content is hidden':'';if(cols[i]?.redacted)td.className='db-redacted';row.append(td)
   }body.append(row)}tableEl.append(body);content.replaceChildren(tableEl);
  }
  dlg.querySelector('#dbRowsPrev').disabled=page<=1;dlg.querySelector('#dbRowsNext').disabled=!data.has_next;
  dlg.querySelector('#dbRowsPage').textContent=`Page ${page} · ${items.length} rows`;
 }catch(err){content.textContent=err.message||'Unable to inspect this table.';dlg.querySelector('#dbRowsNext').disabled=true}
}
export async function loadDatabase(){
 const root=$('#databaseTables');if(!root)return;
 root.innerHTML='<p class="admin-empty">Inspecting table metadata…</p>';
 try{
  const data=await window.APIManager.getDatabaseTables();
  $('#databaseSummary').textContent=`${data.table_count} accessible tables · ${fmtBytes(data.storage_bytes)} database storage · Select View rows for a safe 20-row preview`;
  root.innerHTML=`<table class="admin-metadata-table"><thead><tr><th>Schema</th><th>Table</th><th>Estimated rows</th><th>Storage</th><th>Inspect</th></tr></thead><tbody>${(data.items||[]).map(t=>`<tr><td>${escapeHTML(t.schema)}</td><td><strong>${escapeHTML(t.table)}</strong></td><td>${Number(t.estimated_rows||0).toLocaleString()}</td><td>${fmtBytes(t.bytes)}</td><td><button type="button" class="db-inspect-button" data-schema="${escapeHTML(t.schema)}" data-table="${escapeHTML(t.table)}">View rows</button></td></tr>`).join('')}</tbody></table>`;
  root.querySelectorAll('.db-inspect-button').forEach(button=>button.addEventListener('click',()=>void inspectRows(button.dataset.schema,button.dataset.table,1)));
 }catch(err){$('#databaseSummary').textContent='Database unavailable';root.innerHTML=`<p class="admin-empty">${escapeHTML(err.message)}</p>`}
}
export async function loadServer(){
 if(serverBusy)return;serverBusy=true;
 try{
  const d=await window.APIManager.getServerInfo();const uptime=d.uptime_seconds||0;
  $('#serverSummary').textContent=`${d.hosting} · Online since ${new Date(d.started_at).toLocaleString()} · Uptime ${Math.floor(uptime/3600)}h ${Math.floor((uptime%3600)/60)}m`;
  const cpu=Number(d.cpu_usage_percent),ramTotal=Number(d.ram_total_bytes)||0,ramAvailable=Number(d.ram_available_bytes)||0;
  const ramPct=ramTotal>0?100*(ramTotal-ramAvailable)/ramTotal:-1;
  if(cpu>=0)record(cpuPoints,cpu);if(ramPct>=0)record(ramPoints,ramPct);
  const cards=[
   resourceCard('CPU usage',d.cpu_model||'CPU unavailable',cpu>=0?cpu:-1,`${d.cpu_logical} logical processors · ${d.platform} / ${d.architecture}`,cpuPoints),
   resourceCard('Memory',ramTotal?`${fmtBytes(ramTotal-ramAvailable)} / ${fmtBytes(ramTotal)}`:`${fmtBytes(d.ram_process_bytes)} process`,ramPct,ramTotal?`${fmtBytes(ramAvailable)} currently available`:'Host memory telemetry unavailable',ramPoints),
   ['Operating system',d.os_name||d.platform],['CPU model',d.cpu_model||'Unavailable'],
   ['Process memory',fmtBytes(d.ram_process_bytes)],
   ['Storage',d.storage_total_bytes?`${fmtBytes(d.storage_free_bytes)} free / ${fmtBytes(d.storage_total_bytes)} total`:d.storage],
   ['GPU',d.gpu||'Not reported'],['Internet',d.internet||'Not measured'],
   ['Database',d.database_connected?'Connected':'Unavailable'],['Active routines',String(d.goroutines)]
  ];
  $('#serverMetrics').innerHTML=cards.slice(0,2).join('')+cards.slice(2).map(([name,value])=>`<div class="admin-card server-metric"><small>${escapeHTML(name)}</small><strong>${escapeHTML(value||'Unavailable')}</strong></div>`).join('');
 }catch(err){$('#serverSummary').textContent='Server monitoring unavailable';$('#serverMetrics').innerHTML=`<p class="admin-empty">${escapeHTML(err.message)}</p>`}
 finally{serverBusy=false}
 await refreshLogs();
}
async function refreshLogs(){if(location.hash!=='#server')return;
 try{const d=await window.APIManager.getServerLogs();const box=$('#serverTerminal');if(!box)return;
  box.replaceChildren();for(const line of (d.lines||[]).slice(-50)){const p=document.createElement('p');p.textContent=line;box.append(p)}if(!box.childNodes.length)box.textContent='No recent application events.';
  $('#serverLogState').textContent='Read only · Live polling (5s)';
 }catch{$('#serverLogState').textContent='Reconnecting…'}
}
export function initOperations(){
 $('#databaseRefresh')?.addEventListener('click',()=>void loadDatabase());$('#serverRefresh')?.addEventListener('click',()=>void loadServer());
 $('#serverNetworkCheck')?.addEventListener('click',async e=>{
  const button=e.currentTarget,result=$('#serverNetworkResult');button.disabled=true;button.textContent='Checking…';
  if(result)result.textContent='Querying public network and measuring a small download sample…';
  try{const r=await window.APIManager.checkServerNetwork();
   if(result)result.textContent=`Network operator: ${r.provider} · Public IP: ${r.public_ip} · Sample download: ${Number.isFinite(Number(r.download_mbps))&&r.download_mbps!=null?Number(r.download_mbps).toFixed(1)+' Mbps':'Unavailable'}. ${r.accuracy||''}`;
  }catch(err){if(result)result.textContent=`Network check unavailable: ${err.message}`}
  finally{button.disabled=false;button.textContent='Run network check'}
 });
 const dlg=rowInspector();
 dlg.querySelector('#dbRowsPrev').addEventListener('click',()=>{if(inspectState.page>1)void inspectRows(inspectState.schema,inspectState.table,inspectState.page-1)});
 dlg.querySelector('#dbRowsNext').addEventListener('click',()=>void inspectRows(inspectState.schema,inspectState.table,inspectState.page+1));
 if(monitor)clearInterval(monitor);
 monitor=setInterval(()=>{if(location.hash==='#server'&&!document.hidden)void loadServer()},5000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&location.hash==='#server')void loadServer()});
}
