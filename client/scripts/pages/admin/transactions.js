import {escapeHTML,formatDate,confirmAction} from './helpers.js';
const $=s=>document.querySelector(s);
const money=c=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format((Number(c)||0)/100);
let page=1,maxPage=1,lastStatus='',items=[],visibility='active';
const label=s=>({paid:'Verified paid',pending:'Checkout pending',failed:'Failed'})[s]||s;
const projectLabel=s=>s==='paid'?'Fully paid':s==='payment_approved'?'Partially paid':s==='cancelled'?'Cancelled':'Awaiting downpayment';
const pct=x=>x.project_price_centavos>0?Math.min(100,Math.round((Number(x.project_paid_centavos)||0)*100/x.project_price_centavos)):0;
function record(x){const percent=pct(x);return `<article class="transaction-record" data-transaction-id="${escapeHTML(x.id)}">
 <div class="transaction-icon" aria-hidden="true">${x.status==='paid'?'✓':'◷'}</div>
 <div class="transaction-main"><div class="transaction-title"><strong>${escapeHTML(x.project_title)}</strong><span class="transaction-badge ${escapeHTML(x.status)}">${escapeHTML(label(x.status))}</span>${x.archived?'<span class="transaction-badge">Archived</span>':''}</div>
 <p class="transaction-owner">${escapeHTML(x.owner_name||'Guest visitor')} · ${escapeHTML(x.customer_email||'No email')} ${x.customer_phone?' · '+escapeHTML(x.customer_phone):''}</p>
 <p class="transaction-details">${escapeHTML(x.checkout_session_id)} · ${escapeHTML(formatDate(x.paid_at||x.created_at))}</p>
 <div class="transaction-project-state"><span>${projectLabel(x.project_status)}</span><span>${percent}% · Received ${money(x.project_paid_centavos)} / ${money(x.project_price_centavos)}</span></div>
 <span class="transaction-progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Project payment progress"><span style="width:${percent}%"></span></span>
 <div class="transaction-view-actions"><button type="button" data-transaction-action="view">View details</button>${x.archived?'':'<button type="button" data-transaction-action="archive" class="danger">Delete from view</button>'}</div>
 </div><div class="transaction-amount"><strong>${money(x.amount_centavos)}</strong><small>PHP · ${escapeHTML(x.status)}</small></div></article>`}
function viewDetails(x){const dialog=$('#transactionDetailsModal');if(!dialog)return;
 $('#transactionModalHeading').textContent=x.project_title;
 $('#transactionModalBody').innerHTML=`<p class="description">${escapeHTML(x.project_description||'No description supplied.')}</p><dl>
 <div><dt>Project owner</dt><dd>${escapeHTML(x.owner_name||'Guest visitor')}</dd></div>
 <div><dt>Project state</dt><dd>${escapeHTML(projectLabel(x.project_status))}</dd></div>
 <div><dt>Checkout amount</dt><dd>${money(x.amount_centavos)}</dd></div>
 <div><dt>Verified received</dt><dd>${money(x.project_paid_centavos)} / ${money(x.project_price_centavos)}</dd></div>
 <div><dt>Payment confirmation</dt><dd>${escapeHTML(label(x.status))}</dd></div>
 <div><dt>Progress</dt><dd>${pct(x)}% completed</dd></div>
 <div><dt>Email</dt><dd>${escapeHTML(x.customer_email||'Not provided')}</dd></div>
 <div><dt>Phone</dt><dd>${escapeHTML(x.customer_phone||'Not provided')}</dd></div>
 </dl><p class="transaction-details">Checkout session: ${escapeHTML(x.checkout_session_id)}</p><span class="transaction-progress" role="progressbar" aria-valuenow="${pct(x)}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct(x)}%"></span></span><p class="description">Only PayMongo-verified payment events or authenticated server-to-gateway reconciliation may change received funds. Archiving leaves the financial ledger intact.</p>`;
 dialog.showModal();}
export async function loadTransactions(){
 const root=$('#transactionRecords');if(!root)return;
 lastStatus=$('#transactionStatusFilter')?.value||'';
 root.innerHTML='<p class="admin-empty">Loading checkout history…</p>';
 try{
  const data=await window.APIManager.getAdminTransactions(page,lastStatus,visibility);
  maxPage=Math.max(1,data.pages||1);page=Math.min(maxPage,data.page||1);items=data.items||[];
  const verified=items.filter(x=>x.status==='paid');
  $('#transactionSummary').textContent=`${data.total} checkout records · ${verified.length} verified on this page · ${money(verified.reduce((sum,x)=>sum+Number(x.amount_centavos||0),0))} verified this page`;
  $('#transactionPage').textContent=`Page ${page} of ${maxPage}`;
  $('#transactionPrev').disabled=page<=1;$('#transactionNext').disabled=page>=maxPage;
  root.innerHTML=items.length?items.map(record).join(''):'<p class="admin-empty">No matching transactions.</p>';
 }catch(err){root.innerHTML=`<p class="admin-empty">${escapeHTML(err.message)}</p>`}
}
export function initTransactions(){
 // Admin already maintains one authenticated Chat WebSocket for all panels.
 // Refresh transactions on verified project_offer events, not on a timer.
 const visible=()=>document.querySelector('[data-view="transactions"]')?.classList.contains('active');
 document.addEventListener('portfolio:payment-update',()=>{if(visible())void loadTransactions()});
 document.addEventListener('portfolio:payment-reconnected',()=>{if(visible())void loadTransactions()});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden&&visible())void loadTransactions()});
 $('#transactionStatusFilter')?.addEventListener('change',()=>{page=1;void loadTransactions()});
 document.querySelectorAll('[data-transaction-visibility]').forEach(button=>button.addEventListener('click',()=>{
   visibility=button.dataset.transactionVisibility||'active';
   document.querySelectorAll('[data-transaction-visibility]').forEach(item=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',String(active))});
   page=1;void loadTransactions();
 }));
 $('#transactionPrev')?.addEventListener('click',()=>{if(page>1){page--;void loadTransactions()}});
 $('#transactionNext')?.addEventListener('click',()=>{if(page<maxPage){page++;void loadTransactions()}});
 $('#transactionRefresh')?.addEventListener('click',()=>void loadTransactions());
 $('#transactionModalClose')?.addEventListener('click',()=>$('#transactionDetailsModal')?.close());
 $('#transactionDetailsModal')?.addEventListener('click',e=>{if(e.target.id==='transactionDetailsModal')e.target.close()});
 $('#transactionClearPaid')?.addEventListener('click',async()=>{
  if(!await confirmAction({title:'Archive verified payments from this list?',message:'This only hides paid rows from the default transaction view. Money received, project balances and the payment audit trail stay unchanged. Choose Archived to see them again.',confirmLabel:'Archive paid rows'}))return;
  try{const result=await window.APIManager.clearPaidAdminTransactions();window.UI.toast(`${result.archived_count} paid record(s) archived; balances preserved.`,{title:'Transaction history'});page=1;await loadTransactions()}
  catch(e){window.UI.toast(e.message,{title:'Archive failed',type:'error'})}
 });
 $('#transactionRecords')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-transaction-action]');if(!btn)return;const id=btn.closest('[data-transaction-id]')?.dataset.transactionId;
  const x=items.find(x=>x.id===id);if(!x)return;
  if(btn.dataset.transactionAction==='view'){viewDetails(x);return}
  if(btn.dataset.transactionAction==='archive'){
   if(!await confirmAction({title:'Remove transaction from the default view?',message:'This archives the entry but does not cancel PayMongo checkout, erase payment proof or modify the received balance.',confirmLabel:'Archive record'}))return;
   btn.disabled=true;try{await window.APIManager.archiveAdminTransaction(id);window.UI.toast('Transaction archived; ledger preserved.',{title:'Payments'});await loadTransactions()}
   catch(err){window.UI.toast(err.message,{title:'Unable to archive',type:'error'});btn.disabled=false}return;
  }

 });
}
