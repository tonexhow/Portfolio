import {escapeHTML,confirmAction} from './helpers.js';
const $=s=>document.querySelector(s);
const names={kaabag:'KaaBAG · Private',gemini:'Google Gemini',groq:'Groq',cloudflare:'Cloudflare Workers AI',mistral:'Mistral',cohere:'Cohere',openrouter:'OpenRouter'};
const providers=Object.keys(names);
let ready=false, providerPage=1, draftPage=1;
const perPage=6;let providerItems=[],draftItems=[];
const uiIcons=Object.freeze({
  eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.7-7 10-7 10 7 10 7-3.7 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.6 5.1c.45-.07.92-.1 1.4-.1 6.3 0 10 7 10 7a15.1 15.1 0 0 1-3.1 3.9M6.1 6.1C3.5 8.2 2 12 2 12s3.7 7 10 7c1.56 0 2.98-.45 4.22-1.1"/></svg>',
  copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
  spark:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2Z"/></svg>',
  pulse:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12h4l3-7 5 14 3-7h5"/></svg>',
  cloud:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 17a4 4 0 0 0-.5-7.97 7 7 0 0 0-13.1 1.1A4 4 0 0 0 7 18h12"/></svg>',
  flow:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="8" height="6" rx="1.5"/><rect x="14" y="15" width="8" height="6" rx="1.5"/><path d="M10 6h4a4 4 0 0 1 4 4v5M6 9v4a4 4 0 0 0 4 4h4"/></svg>',
  layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 10 6-10 6L2 9l10-6ZM2 14l10 6 10-6M2 10l10 6 10-6"/></svg>',
  orbit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(45 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-45 12 12)"/></svg>',
  router:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M7 6.5 10.6 17M17 6.5 13.4 17M7 5h10"/></svg>'
});
const providerGlyph={kaabag:'orbit',gemini:'spark',groq:'pulse',cloudflare:'cloud',mistral:'layers',cohere:'flow',openrouter:'router'};
function iconAction(name,title,action){return `<button type="button" class="ai-icon-action" data-ai-action="${action}" title="${title}" aria-label="${title}">${uiIcons[name]}</button>`}
function providerIcon(name){return uiIcons[providerGlyph[name]||'spark']}
function title(provider){return names[provider]||provider}
function renderProvider(x){
 return `<article class="ai-provider-card ${x.enabled?'':'disabled'}" data-ai-id="${escapeHTML(x.id)}" data-key-hint="${escapeHTML(x.key_hint||'••••')}">
  <div class="ai-provider-icon" aria-label="${escapeHTML(title(x.provider))}">${providerIcon(x.provider)}</div>
  <div class="ai-provider-body"><div class="ai-provider-row"><strong>${escapeHTML(x.label||title(x.provider))}</strong><span class="ai-status-pill ${x.enabled?'enabled':'disabled'}">${x.enabled?'Enabled':'Disabled'}</span></div>
    <small>${escapeHTML(title(x.provider))} · Priority ${x.priority} · ${escapeHTML(x.key_hint||'Protected key')}</small>
    <p>Model: ${escapeHTML(x.model||'Provider default')}</p><div class="ai-key-controls"><code data-ai-masked>${escapeHTML(x.key_hint||'••••')}</code>${iconAction('eye','View key','reveal')}${iconAction('copy','Copy key','copy')}</div>
    <form class="ai-provider-edit" hidden>
      <label>Name<input name="label" maxlength="80" value="${escapeHTML(x.label||'')}"></label>
      <label>Model<input name="model" maxlength="140" value="${escapeHTML(x.model||'')}" placeholder="Provider default"></label>
      <label>Priority<input name="priority" type="number" min="0" max="10000" value="${x.priority}"></label>
      <label>Replace key (leave blank to keep existing)<input name="api_key" type="password" autocomplete="new-password" maxlength="4000" placeholder="••••••••"></label>
      <div class="ai-inline-actions"><button type="submit" class="ai-primary-btn">Save changes</button><button type="button" data-ai-action="cancel">Cancel</button></div>
    </form>
  </div>
  <div class="ai-provider-actions"><button type="button" data-ai-action="edit">Edit</button><button type="button" data-ai-action="toggle">${x.enabled?'Disable':'Enable'}</button><button type="button" data-ai-action="remove" class="danger">Remove</button></div>
 </article>`;
}
function renderDraft(x){
 return `<article class="ai-draft-card" data-draft-id="${x.id}">
 <div class="ai-draft-top"><div><small>${escapeHTML(x.source_type)} #${x.source_id}</small><strong>${escapeHTML(x.subject)}</strong></div><span class="ai-status-pill ${x.sent?'enabled':'disabled'}">${x.sent?'Sent':'Needs review'}</span></div>
 <small>To: ${escapeHTML(x.recipient_email||'No verified email — cannot send')}</small>
 <form class="ai-draft-form"><label>Subject<input name="subject" value="${escapeHTML(x.subject)}" maxlength="160" ${x.sent?'disabled':''} required></label>
 <label>Review and edit the AI draft<textarea name="message" rows="5" maxlength="4500" ${x.sent?'disabled':''} required>${escapeHTML(x.message)}</textarea></label>
 <p class="ai-footnote">AI-generated messages disclose AI assistance. When automatic sending is enabled, successful SMTP deliveries remain here as history for 15 days.</p>
 ${x.sent?'':`<button type="submit" class="ai-primary-btn" ${x.recipient_email?'':'disabled'}>Send reviewed email</button>`}
 </form></article>`;
}
export async function loadArtificialIntelligence(){
 const root=$('#aiProviderList');if(!root)return;
 root.innerHTML='<p class="admin-empty">Loading assistant configuration…</p>';
 try{
  const config=await window.APIManager.getAIProviders();ready=config.encryption_ready;providerItems=config.items||[];
  $('#aiMasterKeyNote').textContent=ready
   ?'Encrypted credential storage is ready. Admin keys override private environment fallbacks.'
   :config.encryption_state==='invalid'
    ?'The Server has an AI encryption key, but it is not valid base64 for exactly 32 bytes. Correct the private AI_KEY_ENCRYPTION_KEY and restart Go. Keep the original key for credentials already encrypted with it.'
    :'Credential storage is locked. Set AI_KEY_ENCRYPTION_KEY to the base64 output of 32 random bytes in the private Server .env and restart Go. Never put this secret in the browser.';
  $('#aiAutodraftNote').textContent=config.auto_drafts?(config.auto_send?'AI-assisted emails send automatically when the recipient and SMTP are valid. Sent history expires after 15 days.':'AI drafting enabled; messages await review. Enable AI_AUTOSEND_ENABLED=true for automatic delivery.'):'AI drafting is disabled. Set AI_AUTODRAFT_ENABLED=true on the private server.';
  $('#aiStatusLabel').textContent=config.online?'Recent AI response verified':'No recent provider success · local fallback active';
  renderProviders();
 }catch(err){root.innerHTML=`<p class="admin-empty">${escapeHTML(err.message)}</p>`}
 try{const data=await window.APIManager.getAIReplyDrafts();draftItems=data.items||[];renderDrafts()}
 catch(err){$('#aiDraftList').innerHTML=`<p class="admin-empty">${escapeHTML(err.message)}</p>`}
}
function renderPage(list,render,container,pageLabel,previous,next,page){
 const total=Math.max(1,Math.ceil(list.length/perPage)),current=Math.min(total,Math.max(1,page));
 const slot=$(container);if(slot)slot.innerHTML=list.length?list.slice((current-1)*perPage,current*perPage).map(render).join(''):'<p class="admin-empty">No records found.</p>';
 $(pageLabel).textContent=`Page ${current} of ${total} · ${list.length} record${list.length===1?'':'s'}`;
 $(previous).disabled=current===1;$(next).disabled=current===total;
 return current;
}
function renderProviders(){providerPage=renderPage(providerItems,renderProvider,'#aiProviderList','#aiPage','#aiPrev','#aiNext',providerPage)}
function renderDrafts(){draftPage=renderPage(draftItems,renderDraft,'#aiDraftList','#aiDraftPage','#aiDraftPrev','#aiDraftNext',draftPage)}
export function initArtificialIntelligence(){
 $('#aiPrev')?.addEventListener('click',()=>{providerPage--;renderProviders()});$('#aiNext')?.addEventListener('click',()=>{providerPage++;renderProviders()});
 $('#aiDraftPrev')?.addEventListener('click',()=>{draftPage--;renderDrafts()});$('#aiDraftNext')?.addEventListener('click',()=>{draftPage++;renderDrafts()});
 $('#aiProviderType').innerHTML=providers.map(id=>`<option value="${id}">${escapeHTML(title(id))}</option>`).join('');
 $('#aiAddProvider')?.addEventListener('submit',async e=>{
  e.preventDefault();const form=e.currentTarget;const data=new FormData(form);const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{await window.APIManager.createAIProvider({provider:data.get('provider'),label:data.get('label'),model:data.get('model'),priority:Number(data.get('priority')),api_key:data.get('api_key'),enabled:!!data.get('enabled')});form.reset();
    // Custom selects are visual wrappers. Keep the native value AND visible
    // trigger aligned when the form resets after saving a credential.
    const provider=form.elements.namedItem('provider');
    if(provider instanceof HTMLSelectElement){provider.selectedIndex=0;provider.dispatchEvent(new Event('change',{bubbles:true}));}
    window.UI.toast('Encrypted credential added to AI routing.',{title:'AI settings'});await loadArtificialIntelligence()}
  catch(err){window.UI.toast(err.message,{title:'Unable to save key',type:'error'})}finally{button.disabled=false}
 });
 $('#aiProviderList')?.addEventListener('click',async e=>{
  const btn=e.target.closest('[data-ai-action]');if(!btn)return;
  const card=btn.closest('[data-ai-id]');const id=card?.dataset.aiId;if(!id)return;
  const action=btn.dataset.aiAction,form=card.querySelector('form');
  if(action==='reveal'||action==='copy'){
    // Do not retain keys in application state, HTML attributes, localStorage or logs.
    if(!await confirmAction({title:action==='copy'?'Copy this private API key?':'Reveal this private API key?',message:'Anyone with access to your screen or clipboard may see this credential. Only continue on a trusted computer.',confirmLabel:action==='copy'?'Copy key':'Reveal key'}))return;
    btn.disabled=true;try{
      const {api_key:key}=await window.APIManager.revealAIProvider(id);
      if(action==='copy'){await navigator.clipboard.writeText(key);window.UI.toast('Key copied. Clear your clipboard when finished.',{title:'Private credential'});}
      else{const masked=card.querySelector('[data-ai-masked]');masked.textContent=key;masked.style.overflowWrap='anywhere';btn.innerHTML=uiIcons.eyeOff;btn.dataset.aiAction='hide';btn.setAttribute('aria-label','Hide key');btn.title='Hide key';setTimeout(()=>{if(masked.isConnected){masked.textContent=card.dataset.keyHint||'••••';btn.innerHTML=uiIcons.eye;btn.dataset.aiAction='reveal';btn.setAttribute('aria-label','View key');btn.title='View key'}},20000)}
    }catch(err){window.UI.toast(err.message,{title:'Could not retrieve key',type:'error'})}finally{btn.disabled=false}return;
  }
  if(action==='hide'){card.querySelector('[data-ai-masked]').textContent=card.dataset.keyHint||'••••';btn.innerHTML=uiIcons.eye;btn.dataset.aiAction='reveal';btn.setAttribute('aria-label','View key');btn.title='View key';return}
  if(action==='edit'){form.hidden=false;form.querySelector('input')?.focus();return}
  if(action==='cancel'){form.hidden=true;return}
  if(action==='remove'&&!await confirmAction({title:'Remove this API key?',message:'The encrypted key is permanently removed. Other entries and private environment fallbacks are unaffected.',confirmLabel:'Remove key'}))return;
  btn.disabled=true;
  try{
   if(action==='remove')await window.APIManager.deleteAIProvider(id);
   if(action==='toggle')await window.APIManager.updateAIProvider(id,{label:form.elements.label.value,model:form.elements.model.value,enabled:btn.textContent==='Enable'});
   await loadArtificialIntelligence();window.UI.toast('Provider settings updated.',{title:'AI settings'});
  }catch(err){window.UI.toast(err.message,{title:'AI settings',type:'error'});btn.disabled=false}
 });
 $('#aiProviderList')?.addEventListener('submit',async e=>{
  if(!e.target.matches('.ai-provider-edit'))return;e.preventDefault();const form=e.target;const id=form.closest('[data-ai-id]')?.dataset.aiId;
  const data=new FormData(form);const button=form.querySelector('[type=submit]');button.disabled=true;
  try{await window.APIManager.updateAIProvider(id,{label:data.get('label'),model:data.get('model'),priority:Number(data.get('priority')),api_key:data.get('api_key')});await loadArtificialIntelligence();window.UI.toast('Saved with encryption.',{title:'AI settings'})}
  catch(err){window.UI.toast(err.message,{title:'Key update failed',type:'error'});button.disabled=false}
 });
 $('#aiDraftList')?.addEventListener('submit',async e=>{
  const form=e.target;if(!form.matches('.ai-draft-form'))return;e.preventDefault();const id=form.closest('[data-draft-id]').dataset.draftId;
  const data=new FormData(form);if(!await confirmAction({title:'Send this reviewed AI email?',message:'The draft will be sent to the displayed recipient through your configured SMTP service. Verify the wording first.',confirmLabel:'Send email'}))return;
  const button=form.querySelector('[type="submit"]');button.disabled=true;
  try{await window.APIManager.sendAIReplyDraft(id,{subject:data.get('subject'),message:data.get('message')});window.UI.toast('Reviewed email sent.',{title:'Email'});await loadArtificialIntelligence()}
  catch(err){window.UI.toast(err.message,{title:'Email not sent',type:'error'});button.disabled=false}
 });
 $('#aiTestProviders')?.addEventListener('click',async e=>{
  const button=e.currentTarget;button.disabled=true;button.textContent='Testing providers…';
  try{const result=await window.APIManager.testAIHealth();
    const list=(result.providers||[]).map(x=>`${title(x.provider)}: ${x.status}${x.latency_ms?` (${x.latency_ms} ms)`:''}`);
    $('#aiProviderTestResults').textContent=list.length?list.join(' · '):'No configured providers.';
    window.UI.toast('Provider checks completed. See diagnostic results.',{title:'AI diagnostics'});
  }catch(err){window.UI.toast(err.message,{title:'Provider diagnostics',type:'error'})}
  finally{button.disabled=false;button.textContent='Test connections'}
 });
 $('#aiRefresh')?.addEventListener('click',()=>void loadArtificialIntelligence());
}
