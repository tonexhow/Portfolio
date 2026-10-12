export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function escapeHTML(value=""){const d=document.createElement("div");d.textContent=value??"";return d.innerHTML}
export function formatDate(value){const d=new Date(value);return Number.isNaN(d.getTime())?"—":new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(d)}
export function formatNumber(value){return new Intl.NumberFormat().format(Number(value)||0)}
export function debounce(fn, delay=280){let t;return (...args)=>{clearTimeout(t);t=setTimeout(()=>fn(...args),delay)}}

const modalResolvers=new Map();

export function openModal(id){
  const modal=document.getElementById(id);
  if(!modal)return;
  modal.hidden=false;
  document.body.style.overflow="hidden";
}

export function closeModal(id,result=false){
  const modal=document.getElementById(id);
  if(!modal)return;
  modal.hidden=true;
  if(!document.querySelector(".modal-backdrop:not([hidden])"))document.body.style.overflow="";
  const resolver=modalResolvers.get(id);
  if(resolver){modalResolvers.delete(id);resolver(Boolean(result))}
}

function ensureConfirmModal(){
  const id="adminConfirmModal";
  let modal=document.getElementById(id);
  if(modal)return modal;

  modal=document.createElement("div");
  modal.className="modal-backdrop";
  modal.id=id;
  modal.hidden=true;
  modal.innerHTML=`<div class="management-modal small" role="dialog" aria-modal="true" aria-labelledby="adminConfirmTitle" aria-describedby="adminConfirmMessage">
    <span class="modal-icon danger" aria-hidden="true">!</span>
    <h2 id="adminConfirmTitle">Confirm action</h2>
    <p id="adminConfirmMessage">This action cannot be undone.</p>
    <div class="modal-actions"><button class="modal-secondary" id="adminConfirmCancel" type="button">Cancel</button><button class="modal-danger" id="adminConfirmAction" type="button">Delete</button></div>
  </div>`;
  document.body.append(modal);
  $("#adminConfirmCancel",modal).addEventListener("click",()=>closeModal(id,false));
  $("#adminConfirmAction",modal).addEventListener("click",()=>closeModal(id,true));
  modal.addEventListener("click",event=>{if(event.target===modal)closeModal(id,false)});
  return modal;
}

export function confirmAction({title="Confirm action",message="This action cannot be undone.",confirmLabel="Delete",cancelLabel="Cancel"}={}){
  const modal=ensureConfirmModal();
  const id=modal.id;
  const existing=modalResolvers.get(id);
  if(existing){modalResolvers.delete(id);existing(false)}
  $("#adminConfirmTitle",modal).textContent=title;
  $("#adminConfirmMessage",modal).textContent=message;
  $("#adminConfirmAction",modal).textContent=confirmLabel;
  $("#adminConfirmCancel",modal).textContent=cancelLabel;
  openModal(id);
  requestAnimationFrame(()=>$("#adminConfirmAction",modal)?.focus());
  return new Promise(resolve=>modalResolvers.set(id,resolve));
}

export function setEmpty(root, message){root.innerHTML=`<div class="admin-empty">${escapeHTML(message)}</div>`}
