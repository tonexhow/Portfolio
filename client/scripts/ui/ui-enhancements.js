/* Progressive, dependency-free improvements; original form elements retain values/events. */
let openMenu=null;
function closeMenu(){
  if(!openMenu)return;
  openMenu.menu.hidden=true;
  openMenu.button.setAttribute("aria-expanded","false");
  openMenu=null;
}
function placeMenu(button,menu){
  const r=button.getBoundingClientRect(), spaceBelow=innerHeight-r.bottom-14;
  menu.style.left=`${Math.max(8,r.left)}px`;
  menu.style.width=`${Math.max(135,r.width)}px`;
  menu.style.maxWidth=`calc(100vw - ${Math.max(8,r.left)+8}px)`;
  const h=Math.min(250,menu.scrollHeight||250);
  menu.style.top=`${spaceBelow<h&&r.top>spaceBelow?Math.max(8,r.top-h-5):r.bottom+5}px`;
}
function upgradeSelect(select){
  if(select.dataset.jpUpgraded||select.multiple||select.size>1)return;
  select.dataset.jpUpgraded="true";
  const wrap=document.createElement("div");wrap.className="jp-select";
  select.parentNode.insertBefore(wrap,select);wrap.append(select);
  const button=document.createElement("button");button.className="jp-select-trigger";button.type="button";
  const label=select.closest("label")?.querySelector("span")?.textContent?.trim()||select.getAttribute("aria-label")||"Choose an option";
  button.setAttribute("aria-label",label);button.setAttribute("aria-haspopup","listbox");button.setAttribute("aria-expanded","false");
  button.innerHTML='<span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  wrap.append(button);
  const menu=document.createElement("div");menu.className="jp-select-menu";menu.setAttribute("role","listbox");menu.setAttribute("aria-label",label);menu.hidden=true;document.body.append(menu);
  select.tabIndex=-1;select.setAttribute("aria-hidden","true");
  let activeIndex=0;
  const opts=()=>[...select.options].filter(x=>!x.hidden);
  function sync(){button.querySelector("span").textContent=select.selectedOptions[0]?.textContent||"Select"}
  function rebuild(){
    const options=opts();menu.innerHTML="";
    options.forEach((opt,index)=>{
      const item=document.createElement("button");item.type="button";item.className="jp-select-option";item.setAttribute("role","option");item.setAttribute("aria-selected",String(select.value===opt.value));item.disabled=opt.disabled;item.textContent=opt.textContent;
      item.addEventListener("click",()=>choose(index));menu.append(item);
    });
    activeIndex=Math.max(0,options.findIndex(x=>x.value===select.value));sync();
  }
  function choose(index){const option=opts()[index];if(!option||option.disabled)return;
    select.value=option.value;select.dispatchEvent(new Event("change",{bubbles:true}));sync();closeMenu();button.focus();
  }
  function show(){
    if(select.disabled)return;
    if(openMenu?.button===button){closeMenu();return}
    closeMenu();rebuild();menu.hidden=false;button.setAttribute("aria-expanded","true");placeMenu(button,menu);
    openMenu={button,menu};
  }
  button.addEventListener("click",show);
  button.addEventListener("keydown",e=>{
    if(["ArrowDown","ArrowUp","Home","End","Enter"," "].includes(e.key)){
      e.preventDefault();if(menu.hidden)show();
      const max=opts().length-1;
      if(e.key==="ArrowDown")activeIndex=Math.min(max,activeIndex+1);
      if(e.key==="ArrowUp")activeIndex=Math.max(0,activeIndex-1);
      if(e.key==="Home")activeIndex=0;
      if(e.key==="End")activeIndex=max;
      if(e.key==="Enter"||e.key===" ")choose(activeIndex);
      else menu.querySelectorAll("[role=option]")[activeIndex]?.focus();
    }else if(e.key==="Escape"){closeMenu()}
  });
  menu.addEventListener("keydown",e=>{
    if(e.key==="Escape"){e.preventDefault();closeMenu();button.focus();return}
    if(e.key==="ArrowDown"||e.key==="ArrowUp"||e.key==="Home"||e.key==="End"){
      e.preventDefault();const n=menu.querySelectorAll("[role=option]");
      if(e.key==="ArrowDown")activeIndex=Math.min(n.length-1,activeIndex+1);
      if(e.key==="ArrowUp")activeIndex=Math.max(0,activeIndex-1);
      if(e.key==="Home")activeIndex=0;if(e.key==="End")activeIndex=n.length-1;
      n[activeIndex]?.focus();
    }else if(e.key==="Enter"||e.key===" "){e.preventDefault();choose(activeIndex)}
  });
  select.addEventListener("change",sync);sync();
}
let controlsInitialized=false;
export function initCustomControls(root=document,{selects=true}={}){
  if(selects)root.querySelectorAll("select").forEach(upgradeSelect);
  // Keep native title tooltips outside of manually styled, explicitly named controls.
  root.querySelectorAll("button[title],a[title]").forEach(el=>{
    if(!el.hasAttribute("data-tooltip"))el.setAttribute("data-tooltip",el.getAttribute("title"));
    el.removeAttribute("title");
  });
  if(controlsInitialized)return;controlsInitialized=true;
  // One viewport-clamped portal tooltip, instead of a CSS pseudo-element that
  // can be cropped by overflow:hidden on the Admin header, Chat, or footer.
  let activeTip=null,activeTarget=null;
  function hideTip(){activeTip?.remove();activeTip=null;activeTarget=null}
  function showTip(element){
    if(!element)return;
    if(element.hasAttribute('title')){
      if(!element.hasAttribute('data-tooltip'))element.dataset.tooltip=element.getAttribute('title');
      element.removeAttribute('title');
    }
    const content=element.getAttribute('data-tooltip');
    if(!content||content.length>260)return;
    if(activeTarget===element&&activeTip)return;
    hideTip();
    const host=element.closest('dialog[open]')||document.body;
    const tip=document.createElement('div');tip.className='adaptive-viewport-tooltip';tip.setAttribute('role','tooltip');tip.textContent=content;
    host.append(tip);activeTip=tip;activeTarget=element;
    const r=element.getBoundingClientRect(),gap=10,winW=innerWidth,winH=innerHeight;
    const tr=tip.getBoundingClientRect(),spaceBelow=winH-r.bottom-12,spaceAbove=r.top-12;
    const below=spaceBelow>=tr.height+gap || spaceBelow>spaceAbove;
    const top=below?r.bottom+gap:r.top-tr.height-gap;
    const left=Math.max(8,Math.min(winW-tr.width-8,r.left+r.width/2-tr.width/2));
    tip.style.left=`${left}px`;tip.style.top=`${Math.max(8,Math.min(winH-tr.height-8,top))}px`;
  }
  document.addEventListener('pointerover',e=>showTip(e.target.closest?.('[data-tooltip],[title]')),{passive:true});
  document.addEventListener('pointerout',e=>{if(activeTarget&& !activeTarget.contains(e.relatedTarget))hideTip()},{passive:true});
  document.addEventListener('focusin',e=>showTip(e.target.closest?.('[data-tooltip],[title]')));
  document.addEventListener('focusout',hideTip);
  document.addEventListener('scroll',hideTip,true);
  addEventListener('resize',hideTip,{passive:true});
  document.addEventListener("pointerdown",e=>{if(openMenu&&!openMenu.menu.contains(e.target)&&!openMenu.button.contains(e.target))closeMenu()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeMenu()});
  addEventListener("resize",closeMenu,{passive:true});
  addEventListener("scroll",e=>{if(openMenu&&e.target!==openMenu.menu)closeMenu()},{capture:true,passive:true});
}
export async function confirmChatClear(){
  let dialog=document.getElementById("chatClearConfirm");
  if(!dialog){
    dialog=document.createElement("dialog");dialog.id="chatClearConfirm";dialog.className="chat-confirm-dialog";
    dialog.innerHTML=`<form method="dialog"><div class="chat-confirm-icon" aria-hidden="true">!</div><h2>Clear Bot history?</h2><p>This deletes Bot messages saved in this browser. Live Chat messages are not affected.</p><div class="chat-confirm-actions"><button type="submit" value="cancel">Keep messages</button><button type="submit" value="confirm" class="danger">Clear history</button></div></form>`;
    document.body.append(dialog);
  }
  return new Promise(resolve=>{
    dialog.returnValue="cancel";
    dialog.addEventListener("close",()=>resolve(dialog.returnValue==="confirm"),{once:true});
    dialog.showModal();
  });
}
