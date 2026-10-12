/* Role-scoped command catalogue. Commands execute only from a submit or a
 * direct user gesture; model output never gains command privileges. */
export const CHAT_COMMANDS=Object.freeze({
 admin:[
  {name:'/acceptproject',detail:'Review pending project inquiries and accept one',example:'/acceptproject'},
  {name:'/createproject',detail:'Propose a new project agreement',example:'/createproject'},
  {name:'/projects',detail:'Manage this conversation’s projects and inquiries',example:'/projects'},
  {name:'/img',detail:'Add a full-width image below a text message (Admin only)',example:'Here is the preview /img https://images.example.com/mockup.png'},
  {name:'/offers',detail:'Refresh project cards',example:'/offers'},
  {name:'/transactions',detail:'Open the private transaction history',example:'/transactions'},
  {name:'/status',detail:'Check live message delivery',example:'/status'},
  {name:'/help',detail:'Open this command guide',example:'/help'},
  {name:'/clear',detail:'Clear currently displayed chat messages (not server history)',example:'/clear'}],
 visitor:[
  {name:'/createproject',detail:'Open a form to request a project',example:'/createproject'},
  {name:'/projects',detail:'View project inquiries and offers; withdraw pending requests',example:'/projects'},
  {name:'/payments',detail:'Refresh verified project payments',example:'/payments'},
  {name:'/getaichat',detail:'Share a Bot discussion with Admin only with your consent',example:'/getaichat'},
  {name:'/skills',detail:'Explore published skills',example:'/skills'},
  {name:'/contact',detail:'Open contact information',example:'/contact'},
  {name:'/help',detail:'Open this command guide',example:'/help'},
  {name:'/clear',detail:'Clear messages from this local chat window only',example:'/clear'}],
 bot:[
  {name:'/theme',detail:'Change this portfolio’s appearance',example:'/theme dark'},
  {name:'/projects',detail:'Explore published work',example:'/projects'},
  {name:'/skills',detail:'Explore development skills',example:'/skills'},
  {name:'/about',detail:'Learn about the developer',example:'/about'},
  {name:'/getaichat',detail:'Share recent Bot messages with Admin by consent',example:'/getaichat'},
  {name:'/contact',detail:'Open contact details',example:'/contact'},
  {name:'/help',detail:'Open this command guide',example:'/help'},
  {name:'/clear',detail:'Clear your saved local Bot conversation',example:'/clear'}]
});
export function bindSlashCommands(input,role='visitor'){
 if(!input||input.dataset.slashBound)return;
 input.dataset.slashBound='1';
 const parent=input.closest('form')||input.parentElement;
 const list=document.createElement('div');list.className='slash-picker';list.hidden=true;list.setAttribute('role','listbox');list.setAttribute('aria-label','Chat commands');
 parent.classList.add('chat-command-container');parent.append(list);
 let visible=[],selection=0;
 function close(){list.hidden=true;list.replaceChildren();visible=[];input.removeAttribute('aria-activedescendant')}
 function select(item){input.value=item.name+(item.name==='/img'?' ':'');input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();close()}
 function refresh(){
  const value=input.value;if(!/^\/[a-z]*$/i.test(value)||value.length>36){close();return}
  visible=(CHAT_COMMANDS[role]||CHAT_COMMANDS.visitor).filter(x=>x.name.startsWith(value.toLowerCase()));
  if(!visible.length){close();return}selection=Math.min(selection,visible.length-1);
  list.replaceChildren();visible.forEach((item,i)=>{
   const btn=document.createElement('button');btn.type='button';btn.setAttribute('role','option');btn.id=`slash-${role}-${i}`;btn.className=i===selection?'selected':'';btn.setAttribute('aria-selected',String(i===selection));
   const name=document.createElement('strong');name.textContent=item.name;const hint=document.createElement('small');hint.textContent=item.detail;
   btn.append(name,hint);btn.addEventListener('mousedown',e=>e.preventDefault());btn.addEventListener('click',()=>select(item));list.append(btn);
  });list.hidden=false;input.setAttribute('aria-activedescendant',`slash-${role}-${selection}`);
 }
 input.addEventListener('input',refresh);
 input.addEventListener('keydown',e=>{
  if(list.hidden)return;
  if(e.key==='Escape'){e.preventDefault();close();return}
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();selection=(selection+(e.key==='ArrowDown'?1:-1)+visible.length)%visible.length;refresh();return}
  if(e.key==='Tab'||(e.key==='Enter'&&!e.shiftKey)){e.preventDefault();e.stopImmediatePropagation();select(visible[selection])}
 },true);
 input.addEventListener('blur',()=>setTimeout(()=>{if(!list.contains(document.activeElement))close()},160));
 return close;
}
export function parseQuickCommand(body,role='visitor'){
 const content=String(body||'').trim();if(!content.startsWith('/'))return null;
 const match=content.match(/^\/(\w+)(?:\s+(.*))?$/s);if(!match)return null;
 const name='/'+match[1].toLowerCase();if(!(CHAT_COMMANDS[role]||[]).some(x=>x.name===name))return null;
 return {name,arg:(match[2]||'').trim()};
}
export function openCommandHelp(input,role='visitor'){
 const items=CHAT_COMMANDS[role]||CHAT_COMMANDS.visitor;
 let dialog=document.getElementById('jpanoCommandHelp');
 if(!dialog){dialog=document.createElement('dialog');dialog.id='jpanoCommandHelp';dialog.className='chat-command-help-dialog';dialog.innerHTML='<header><div><small>Live chat command guide</small><h2>Available commands</h2><p>Select Use to copy a working template into the chat composer.</p></div><button type="button" class="help-close" aria-label="Close command guide">✕</button></header><div class="chat-command-help-list"></div>';dialog.querySelector('.help-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close()});document.body.append(dialog)}
 const root=dialog.querySelector('.chat-command-help-list');root.replaceChildren();
 for(const item of items){
  const card=document.createElement('article');const main=document.createElement('div');const name=document.createElement('strong');name.textContent=item.name;const detail=document.createElement('p');detail.textContent=item.detail;
  const code=document.createElement('code');code.textContent=item.example||item.name;main.append(name,detail,code);
  const use=document.createElement('button');use.type='button';use.textContent='USE';use.setAttribute('aria-label',`Use ${item.name}`);
  use.addEventListener('click',()=>{if(input){input.value=item.example||item.name;input.dispatchEvent(new Event('input',{bubbles:true}));}dialog.close();input?.focus()});card.append(main,use);root.append(card);
 }
 dialog.showModal();dialog.querySelector('.help-close')?.focus();
}
