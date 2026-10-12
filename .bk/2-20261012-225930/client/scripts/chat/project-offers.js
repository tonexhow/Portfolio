import {qrSVG} from './qr-code.js';

/* Offers are financial records served by Go, not Markdown/AI instructions.
 * This module trusts only project offers returned for the visitor's HTTP-only
 * Live Chat session. All generated text is assigned via textContent. */
const money=cents=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format((Number(cents)||0)/100);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const offers=new Map();let modal=null,active=null,recoveryTimer=null,verifyInFlight=false,watchBaselinePaid=null;
// Verified PayMongo webhooks are delivered over the Live Chat WebSocket.
// Browser recovery is a single, delayed gateway recheck, never the primary
// payment-confirmation channel and never proof of payment on its own.
function stopPaymentWatch(){
  clearTimeout(recoveryTimer);recoveryTimer=null;verifyInFlight=false;watchBaselinePaid=null;
}
function paymentStatusText(text){
  const element=modal?.querySelector('.offer-live-status');
  if(element)element.lastChild.textContent=' '+text;
}
async function checkTrustedPendingPayment(id){
  const offer=offers.get(id);
  if(!offer || active!==id || offer.status==='paid' || offer.status==='cancelled' || document.hidden || verifyInFlight)return;
  verifyInFlight=true;
  try {
    const result=await window.APIManager.verifyOfferPayment(id);
    if(active!==id)return;
    await loadOffers(document.querySelector('#liveChatMessages'));
    if(result.verified)paymentStatusText('Verified by PayMongo — payment recorded.');
    else paymentStatusText('Waiting for PayMongo confirmation. Updates arrive automatically.');
  }catch{
    if(active===id)paymentStatusText('Still awaiting verification. Your balance will update when PayMongo confirms the payment.');
  }finally{verifyInFlight=false}
}
function watchCheckout(id){
  clearTimeout(recoveryTimer);recoveryTimer=null;
  watchBaselinePaid=Number(offers.get(id)?.paid_centavos||0);
  paymentStatusText('Awaiting PayMongo confirmation. Verified payments update instantly through Live Chat.');
  // The Go background recovery worker separately checks delayed/missed webhooks.
  // Only one visitor-side recovery attempt is scheduled, 45 seconds after
  // checkout begins (or when the visitor reopens a pending proposal).
  recoveryTimer=setTimeout(()=>{
    recoveryTimer=null;
    if(active===id&&modal?.open)void checkTrustedPendingPayment(id);
  },45000);
}
function state(o){if(o.status==='paid')return 'Fully paid';if(o.status==='payment_approved'||o.paid_centavos>0)return 'Partially paid';if(o.status==='cancelled')return 'Cancelled';return 'Awaiting downpayment'}
function minimum(o){return Math.max(100,Math.ceil(o.price_centavos*o.downpayment_percent/100)-o.paid_centavos)}
export function offerCard(offer,list){
  if(!offer?.id||!list)return;
  offers.set(offer.id,offer);
  let card=[...list.querySelectorAll('[data-project-offer-id]')].find(n=>n.dataset.projectOfferId===offer.id);
  if(!card){
    card=document.createElement('article');card.className='chat-project-offer-card';card.dataset.projectOfferId=offer.id;
    const button=document.createElement('button');button.type='button';button.addEventListener('click',()=>openOffer(offer.id));
    card.append(button);list.append(card);
  }
  const button=card.querySelector('button');button.replaceChildren();
  const header=document.createElement('span');header.className='offer-card-topline';
  const kicker=document.createElement('span');kicker.className='offer-card-kicker';kicker.textContent='PROJECT · SECURE CHECKOUT';
  const status=document.createElement('span');status.className='offer-card-status';status.textContent=state(offer);status.dataset.state=offer.status;
  header.append(kicker,status);
  const title=document.createElement('strong');title.className='offer-card-title';title.textContent=offer.title;
  const description=document.createElement('span');description.className='offer-card-description';description.textContent=offer.description||'View the proposed project and payment breakdown.';
  const numbers=document.createElement('span');numbers.className='offer-card-numbers';
  const price=document.createElement('span');price.textContent=money(offer.price_centavos);
  const received=document.createElement('small');received.textContent=`Received ${money(offer.paid_centavos||0)}`;
  numbers.append(price,received);
  const progress=document.createElement('span');progress.className='offer-card-track';progress.setAttribute('role','progressbar');
  const percentage=offer.price_centavos>0?Math.min(100,Math.round(100*offer.paid_centavos/offer.price_centavos)):0;
  progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');progress.setAttribute('aria-valuenow',String(percentage));progress.setAttribute('aria-label','Project paid percentage');
  const fill=document.createElement('span');fill.className='offer-card-fill';fill.style.width=`${percentage}%`;progress.append(fill);
  const foot=document.createElement('span');foot.className='offer-card-foot';foot.textContent=offer.status==='paid'?'✓ Payment completed · View details':`Remaining ${money(Math.max(0,offer.price_centavos-offer.paid_centavos))}  ·  View payment`;
  button.append(header,title,description,numbers,progress,foot);
  list.scrollTop=list.scrollHeight;
  if(active===offer.id&&modal?.open){fillModal(offer);if(offer.status==='paid'){stopPaymentWatch();paymentStatusText('Verified by PayMongo — fully paid.')}else if(watchBaselinePaid!==null&&Number(offer.paid_centavos)>watchBaselinePaid){stopPaymentWatch();paymentStatusText('Verified payment received — balance updated instantly.')}}
}
function getModal(){
  if(modal)return modal;
  modal=document.createElement('dialog');modal.id='visitorOfferModal';modal.className='project-offer-modal';
  modal.innerHTML=`<div class="offer-modal-head"><div><small>Project agreement</small><h2 id="offerTitle"></h2></div><button type="button" id="closeOffer" aria-label="Close proposal">✕</button></div>
    <div class="offer-modal-scroll"><p id="offerDescription"></p><div class="offer-metrics"><div><small>Agreed total</small><strong id="offerTotal"></strong></div><div><small>Minimum downpayment</small><strong id="offerDownpayment"></strong></div></div>
    <p id="offerStatus" class="offer-payment-status" role="status"></p><p class="offer-live-status" role="status"><span class="offer-live-dot" aria-hidden="true"></span> Payment confirmation updates automatically after PayMongo verifies it.</p>
    <div class="offer-payment-progress"><div class="offer-progress-track"><i id="offerProgressFill"></i></div><p id="offerProgressLabel">0% paid</p></div>
    <form id="projectOfferPayForm"><label for="offerAmount">Amount to pay (PHP)</label><input id="offerAmount" type="number" step="0.01" inputmode="decimal" min="1" required><small id="offerAmountHelp"></small>
    <div class="offer-fields"><label for="offerPayerEmail">Email (optional)<input id="offerPayerEmail" type="email" maxlength="180" autocomplete="email" placeholder="you@example.com"></label><label for="offerPayerPhone">Contact number (optional)<input id="offerPayerPhone" type="tel" maxlength="25" autocomplete="tel" placeholder="+63 9XX XXX XXXX"></label></div>
    <small>For project follow-ups and receipts. Signed-in account email is suggested when available.</small>
    <button type="submit" id="offerPayButton">Continue to secure payment</button></form>
    <section id="offerCheckout" hidden><div class="offer-qr" id="offerQR"></div><p>Scan this code to open the <strong>PayMongo hosted checkout</strong> on another device, then select QR Ph there. This QR is a link, not the QR Ph payment payload.</p><a id="offerCheckoutLink" target="_blank" rel="noopener noreferrer">Open secure PayMongo checkout</a><small>Payment is approved only after PayMongo confirms it to the server.</small></section></div>`;
  modal.querySelector('#closeOffer').addEventListener('click',()=>modal.close());
  modal.addEventListener('click',e=>{if(e.target===modal)modal.close()});
  modal.addEventListener('close',()=>{active=null;stopPaymentWatch();modal.querySelector('#offerCheckout').hidden=true;});
  modal.querySelector('#projectOfferPayForm').addEventListener('submit',async e=>{
    e.preventDefault();const offer=offers.get(active);if(!offer)return;
    const input=modal.querySelector('#offerAmount'),button=modal.querySelector('#offerPayButton');
    // Round to integer centavos; reject invalid/out-of-range browser values.
    const numeric=Number(input.value),amount=Math.round(numeric*100);
    if(!Number.isFinite(numeric)||!Number.isSafeInteger(amount)||amount<minimum(offer)||amount>offer.price_centavos-offer.paid_centavos){window.UI?.toast?.('Amount is outside the allowed range.',{title:'Payment',type:'error'});return}
    button.disabled=true;button.textContent='Creating secure checkout…';
    try{
      const result=await window.APIManager.createOfferCheckout(offer.id,amount,modal.querySelector('#offerPayerEmail').value.trim(),modal.querySelector('#offerPayerPhone').value.trim());
      const u=new URL(result.checkout_url);
      if(u.protocol!=='https:'||u.hostname!=='checkout.paymongo.com'||u.username||u.password)throw Error('Invalid checkout link');
      modal.querySelector('#offerQR').innerHTML=qrSVG(u.href);
      modal.querySelector('#offerCheckoutLink').href=u.href;
      modal.querySelector('#offerCheckout').hidden=false;
      watchCheckout(offer.id);
      modal.querySelector('#offerCheckout').scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch(err){window.UI?.toast?.(err.message,{title:'PayMongo',type:'error'})}
    finally{button.disabled=false;button.textContent='Continue to secure payment'}
  });
  document.body.append(modal);return modal;
}
function fillModal(o){
  const d=getModal(),set=(sel,v)=>d.querySelector(sel).textContent=v;
  set('#offerTitle',o.title);set('#offerDescription',o.description||'No additional description.');
  set('#offerTotal',money(o.price_centavos));set('#offerDownpayment',`${o.downpayment_percent}% · ${money(Math.ceil(o.price_centavos*o.downpayment_percent/100))}`);
  set('#offerStatus',`${state(o)} · Received ${money(o.paid_centavos)} · Outstanding ${money(Math.max(0,o.price_centavos-o.paid_centavos))}`);
  const percentage=o.price_centavos?Math.min(100,Math.round(o.paid_centavos/o.price_centavos*100)):0;
  d.querySelector('#offerProgressFill').style.width=`${percentage}%`;
  set('#offerProgressLabel',`${percentage}% of total received · Status from verified payment records`);
  const remaining=o.price_centavos-o.paid_centavos,req=minimum(o),form=d.querySelector('#projectOfferPayForm');
  form.hidden=o.status==='paid'||o.status==='cancelled'||remaining<100;
  const input=d.querySelector('#offerAmount');input.min=(req/100).toFixed(2);input.max=(remaining/100).toFixed(2);
  if(!input.value||Number(input.value)<req/100||Number(input.value)>remaining/100)input.value=(req/100).toFixed(2);
  set('#offerAmountHelp',`Pay ${money(req)} minimum, up to ${money(remaining)} remaining. PHP only.`);
}
export function openOffer(id){
  const o=offers.get(id);if(!o)return;
  active=id;const d=getModal();fillModal(o);d.showModal();
  // Suggest, never require, the validated OAuth email for the current visitor.
  void window.APIManager.getChatStatus().then(s=>{if(active!==id)return;const field=d.querySelector('#offerPayerEmail');if(field&&!field.value&&s.identity?.email)field.value=s.identity.email}).catch(()=>{});
  void loadOffers(document.querySelector('#liveChatMessages'),false);
  // No repeated offer polling: WebSocket project_offer events update the open
  // dialog, and reconnect/visibility events refresh the latest saved state.
  // An earlier payment tab may have completed while this modal was closed.
  if(o.status!=='paid'&&o.status!=='cancelled')watchCheckout(id);
  // Signed webhooks + a rate-bounded backend recovery loop update the ledger.
  // Visitor only fetches the resulting state; no manual verification step.
}
export async function loadOffers(list,showError=false){
  if(!list)return;
  try{
    const response=await window.APIManager.getChatOffers();
    const next=new Set((response.offers||[]).map(o=>o.id));
    for(const card of list.querySelectorAll('[data-project-offer-id]'))if(!next.has(card.dataset.projectOfferId))card.remove();
    for(const id of offers.keys())if(!next.has(id))offers.delete(id);
    (response.offers||[]).forEach(o=>offerCard(o,list));
  }catch(err){if(showError)window.UI?.toast?.(err.message,{title:'Project offers',type:'error'})}
}

export function removeArchivedOffer(id,list){
 offers.delete(id);list?.querySelectorAll('[data-project-offer-id]').forEach(card=>{if(card.dataset.projectOfferId===id)card.remove()});
 if(active===id&&modal?.open){modal.close();window.UI?.toast?.('This project agreement was archived by Admin. Any verified payment history remains recorded.',{title:'Project updated'})}
}
