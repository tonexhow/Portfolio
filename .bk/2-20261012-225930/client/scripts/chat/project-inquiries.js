/* Visitor-only persistent project inquiries. Session ownership is enforced by
 * the server's HTTP-only Live Chat cookie; this UI never authorizes records. */
import {openOffer,loadOffers} from './project-offers.js';
const php=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP'}).format((Number(n)||0)/100);
function dialog(id,title){
 let d=document.getElementById(id);
 if(!d){d=document.createElement('dialog');d.id=id;d.className='project-offer-modal project-inquiry-modal';
  const header=document.createElement('header');const heading=document.createElement('h2');heading.textContent=title;const close=document.createElement('button');close.type='button';close.textContent='✕';close.setAttribute('aria-label','Close dialog');close.addEventListener('click',()=>d.close());header.append(heading,close);d.append(header);document.body.append(d);
  d.addEventListener('click',e=>{if(e.target===d)d.close()});
 }
 return d;
}
function field(label,name,tag,attrs={}){
 const wrap=document.createElement('label');wrap.textContent=label;
 const element=document.createElement(tag);element.name=name;
 for(const [key,value] of Object.entries(attrs)){if(value===true)element.setAttribute(key,'');else element.setAttribute(key,String(value))}
 wrap.append(element);return wrap;
}
export function openVisitorCreateProject(){
 const d=dialog('visitorCreateProjectModal','Request a project');
 d.querySelector('form')?.remove();
 const form=document.createElement('form');form.className='project-inquiry-form';
 form.append(field('Project title','title','input',{required:true,minlength:3,maxlength:120,placeholder:'e.g. Restaurant POS and inventory'}),
  field('Description / expected features','description','textarea',{required:true,minlength:10,maxlength:1400,rows:5,placeholder:'Tell me about the features, users, scope and expected delivery.'}),
  field('Estimated budget (PHP)','amount','input',{required:true,type:'number',min:1,max:5000000,step:'0.01',placeholder:'10000.00'}));
 const note=document.createElement('p');note.textContent='This is an inquiry, not a payment request. Admin will review it and may propose a revised scope, amount and downpayment.';
 const submit=document.createElement('button');submit.type='submit';submit.className='primary';submit.textContent='Send project inquiry';form.append(note,submit);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const values=new FormData(form),payload={title:String(values.get('title')||'').trim(),description:String(values.get('description')||'').trim(),amount:Number(values.get('amount'))};
  submit.disabled=true;submit.textContent='Sending…';
  try{await window.APIManager.createChatInquiry(payload);d.close();window.UI?.toast?.('Your project inquiry has been sent for review.',{title:'Project inquiry'});}
  catch(error){window.UI?.toast?.(error.message,{title:'Project inquiry',type:'error'})}
  finally{submit.disabled=false;submit.textContent='Send project inquiry'}
 });
 d.append(form);d.showModal();form.querySelector('input')?.focus();
}
export async function openVisitorProjects(){
 const d=dialog('visitorProjectsModal','Your projects and inquiries');
 let content=d.querySelector('.project-inquiry-items');if(!content){content=document.createElement('div');content.className='project-inquiry-items';d.append(content)}
 content.textContent='Loading your saved requests and agreements…';d.showModal();
 try{
  const [inquiries,offers]=await Promise.all([window.APIManager.getChatInquiries(),window.APIManager.getChatOffers()]);
  content.replaceChildren();const pending=inquiries.items||[],agreements=offers.offers||[];
  d.querySelector('header h2').textContent=`Your projects (${agreements.length}) · Inquiries (${pending.length})`;
  if(!pending.length&&!agreements.length){const p=document.createElement('p');p.textContent='You have no project inquiries or proposals yet. Type /createproject to get started.';content.append(p)}
  for(const x of pending){
   const card=document.createElement('article');card.className='project-inquiry-item';const badge=document.createElement('small');badge.textContent=`INQUIRY · ${x.status}`;
   const title=document.createElement('strong');title.textContent=x.title;const description=document.createElement('p');description.textContent=x.description;
   const budget=document.createElement('span');budget.textContent=`Proposed budget ${php(x.requested_centavos)}`;card.append(badge,title,description,budget);
   if(x.admin_note){const note=document.createElement('p');note.textContent=`Admin note: ${x.admin_note}`;card.append(note)}
   if(x.status==='pending'){
    const withdraw=document.createElement('button');withdraw.type='button';withdraw.textContent='Withdraw inquiry';withdraw.addEventListener('click',async()=>{
     if(!confirm('Withdraw this pending project inquiry?'))return;
     withdraw.disabled=true;try{await window.APIManager.withdrawChatInquiry(x.id);await openVisitorProjects();}catch(e){window.UI?.toast?.(e.message,{title:'Project inquiry',type:'error'});withdraw.disabled=false}
    });card.append(withdraw);
   }content.append(card);
  }
  for(const x of agreements){
   const card=document.createElement('article');card.className='project-inquiry-item';const title=document.createElement('strong');title.textContent=x.title;
   const paid=document.createElement('p');paid.textContent=`${x.status==='paid'?'Fully paid':x.paid_centavos>0?'Partially paid':'Awaiting downpayment'} · Received ${php(x.paid_centavos)} of ${php(x.price_centavos)}`;
   const button=document.createElement('button');button.type='button';button.textContent='View payment details';button.addEventListener('click',async()=>{d.close();await loadOffers(document.querySelector('#liveChatMessages'),true);openOffer(x.id)});
   card.append(title,paid,button);content.append(card);
  }
 }catch(e){content.textContent=e.message||'Unable to fetch project records.'}
}
