import {$,escapeHTML,debounce,setEmpty,openModal,closeModal,confirmAction} from "./helpers.js";
let page=1,pages=1,loaded=false,currentItems=[],positionMode=false,dragKey="";
let galleryItems=[], logoFile=null;
const assetURL=value=>window.PublicStore.apiURL(String(value||"").replace(/^\/api\/public\/project-media\//,"/api/admin/project-media/"));

function renderItem(p){
  const icon=p.icon?`<span class="project-management-icon"><img src="${escapeHTML(assetURL(p.icon))}" alt="" loading="lazy"></span>`:"";
  const stack=(p.stack||[]).slice(0,4).map(x=>`<span>${escapeHTML(x)}</span>`).join("");
  return `<article class="project-management-card ${p.source} ${positionMode?"position-mode":""}" data-project-card="${escapeHTML(p.key)}" draggable="${positionMode}">
    <div class="project-position-badge"><span>#</span>${Number(p.display_order)||0}</div>
    <div class="drag-handle" aria-hidden="${positionMode?"false":"true"}" title="Drag to reorder"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    ${p.images?.[0]?`<img class="project-management-cover" src="${escapeHTML(assetURL(p.images[0]))}" alt="${escapeHTML(p.name)} preview" loading="lazy">`:""}
    <div class="project-management-head">
      <div class="project-management-title">${icon}<div><h3>${escapeHTML(p.name)}</h3><small>${"Database project"}</small></div></div>
      <span class="project-live ${escapeHTML(p.status)}" data-status-key="${escapeHTML(p.key)}"><i></i>${escapeHTML(p.status)}</span>
    </div>
    <p>${escapeHTML(p.description||"No project description.")}</p>
    ${stack?`<div class="project-management-meta">${stack}</div>`:""}
    <div class="project-control-row">
      ${positionMode?`<div class="mobile-position-actions"><button type="button" data-move-project="up" data-project-key="${escapeHTML(p.key)}" aria-label="Move project up">↑</button><button type="button" data-move-project="down" data-project-key="${escapeHTML(p.key)}" aria-label="Move project down">↓</button></div>`:""}
      <div class="project-card-actions">
        <button class="record-action ${p.visible?"primary":""}" type="button" data-project-visible="${escapeHTML(p.key)}" data-visible="${p.visible}">${p.visible?"Displayed":"Hidden"}</button>
        <button class="record-action" type="button" data-project-ping="${escapeHTML(p.key)}">Ping</button>
        ${p.editable?`<button class="record-action" type="button" data-project-edit="${escapeHTML(p.key)}">Edit</button><button class="record-action danger" type="button" data-project-delete="${escapeHTML(p.key)}">Delete</button>`:""}
      </div>
    </div>
  </article>`;
}

function renderCurrent(){
  const root=$("#projectRecords");
  root.classList.toggle("reordering",positionMode);
  if(!currentItems.length){setEmpty(root,"No projects match this view.");return}
  root.innerHTML=currentItems.map(renderItem).join("");
}

async function load(target=page){
  const root=$("#projectRecords");
  root.innerHTML=`<div class="inline-loading"><span class="spinner" aria-hidden="true"></span><span>Loading projects…</span></div>`;
  try{
    const data=await window.APIManager.getAdminProjects({page:target,source:$("#projectSourceFilter").value,q:$("#projectSearch").value.trim()});
    page=Number(data.page||1);pages=Math.max(1,Number(data.total_pages||1));loaded=true;currentItems=data.items||[];
    renderCurrent();
    $("#projectPage").textContent=`Page ${page} of ${pages} · ${data.total||0} projects`;
    $("#projectPrev").disabled=page<=1||positionMode;$("#projectNext").disabled=page>=pages||positionMode;
  }catch(error){setEmpty(root,error.message);window.UI.toast(error.message,{title:"Projects",type:"error"})}
}

function openProjectEditor(item=null){
  $("#projectForm").reset();
  $("#projectKey").value=item?.key||"";
  $("#projectModalTitle").textContent=item?"Edit project":"Add a project";
  $("#projectName").value=item?.name||"";
  $("#projectType").value=item?.type||"";
  $("#projectURL").value=item?.url||"";
  $("#projectDescription").value=item?.description||"";
  $("#projectTechnologies").value=(item?.stack||[]).join(", ");
  $("#projectVisible").checked=item?.visible!==false;
  $("#projectSourceURL").value=item?.source_url||"";
  $("#projectIcon").value=item?.icon||"";
  disposeGallery(); logoFile=null;
  galleryItems=(item?.images||[]).map(url=>({url,preview:assetURL(url),name:url.split("/").pop()}));
  renderGallery();
  openModal("projectModal");
}

async function saveProject(e){
  e.preventDefault();
  const key=$("#projectKey").value,button=$("#saveProjectButton");
  const payload={
    name:$("#projectName").value.trim(),
    type:$("#projectType").value.trim(),
    url:$("#projectURL").value.trim(),
    source_url:$("#projectSourceURL").value.trim(),
    icon:$("#projectIcon").value.trim(),
    description:$("#projectDescription").value.trim(),
    technologies:$("#projectTechnologies").value.split(",").map(x=>x.trim()).filter(Boolean),
    visible:$("#projectVisible").checked
  };
  window.UI.setButtonLoading(button,true,"Saving…");
  try{
    // Upload before committing the record; a failed upload leaves the editor intact.
    if(logoFile){const upload=await window.APIManager.uploadProjectImage(logoFile);payload.icon=upload.url;$("#projectIcon").value=upload.url;logoFile=null;}
    for(const item of galleryItems){if(item.file){const upload=await window.APIManager.uploadProjectImage(item.file);item.url=upload.url;item.file=null;}}
    payload.images=galleryItems.map(item=>item.url);
    if(key)await window.APIManager.updateAdminProject(key,payload);
    else await window.APIManager.addAdminProject(payload);
    closeModal("projectModal");disposeGallery();
    window.UI.toast(key?"Project updated.":"Project added at position 1.",{title:"Projects"});
    page=key?page:1;
    await load(page);
  }catch(error){window.UI.toast(error.message,{title:"Projects",type:"error"})}
  finally{window.UI.setButtonLoading(button,false)}
}

function validFile(file){
  if(!["image/png","image/jpeg","image/webp","image/gif"].includes(file.type)||file.size>5*1024*1024){window.UI.toast("Choose a PNG, JPEG, WebP or GIF up to 5 MB.",{title:"Image not accepted",type:"error"});return false;}return true;
}
function disposeGallery(){for(const item of galleryItems)if(item.preview?.startsWith("blob:"))URL.revokeObjectURL(item.preview);galleryItems=[];}
function renderGallery(){
  const root=$("#projectImageEditor");
  root.innerHTML=galleryItems.map((item,index)=>`<div class="project-editor-image"><img src="${escapeHTML(item.preview)}" alt="Image ${index+1}"><div class="project-editor-image-info"><small>${escapeHTML(item.name||"Project image")}</small><div class="project-image-actions"><span>${index===0?"Cover":`Image ${index+1}`}</span><button type="button" data-gallery-action="left" data-index="${index}" ${index===0?"disabled":""} aria-label="Move image earlier">←</button><button type="button" data-gallery-action="right" data-index="${index}" ${index===galleryItems.length-1?"disabled":""} aria-label="Move image later">→</button><button type="button" data-gallery-action="remove" data-index="${index}" aria-label="Remove image">×</button></div></div></div>`).join("");
  root.querySelectorAll("img").forEach(image=>image.addEventListener("error",()=>{image.src="/assets/projects/project-placeholder.svg";},{once:true}));
}
async function persistCurrentOrder(){
  const cards=[...document.querySelectorAll("#projectRecords [data-project-card]")];
  const keys=cards.map(card=>card.dataset.projectCard).filter(Boolean);
  if(!keys.length)return;
  try{
    await window.APIManager.reorderAdminProjects(keys,(page-1)*20+1);
    window.UI.toast("Project positions updated.",{title:"Projects"});
    await load(page);
  }catch(error){
    window.UI.toast(error.message,{title:"Projects",type:"error"});
    await load(page);
  }
}

function moveCard(key,direction){
  const card=document.querySelector(`[data-project-card="${CSS.escape(key)}"]`);
  if(!card)return;
  const sibling=direction==="up"?card.previousElementSibling:card.nextElementSibling;
  if(!sibling||!sibling.matches("[data-project-card]"))return;
  if(direction==="up")card.parentElement.insertBefore(card,sibling);
  else card.parentElement.insertBefore(sibling,card);
  persistCurrentOrder();
}

async function togglePositionMode(){
  positionMode=!positionMode;
  const button=$("#editProjectPositionButton");
  button.classList.toggle("active",positionMode);
  button.querySelector("span").textContent=positionMode?"Done":"Edit position";
  $("#projectSearch").disabled=positionMode;
  $("#projectSourceFilter").disabled=positionMode;
  if(positionMode){
    $("#projectSearch").value="";
    $("#projectSourceFilter").value="all";
    window.UI.toast("Drag cards or use the arrow controls to change their positions.",{title:"Position mode"});
  }
  await load(page);
}

function initDrag(){
  const root=$("#projectRecords");
  root.addEventListener("dragstart",event=>{
    const card=event.target.closest("[data-project-card]");
    if(!positionMode||!card)return;
    dragKey=card.dataset.projectCard;
    card.classList.add("dragging");
    event.dataTransfer.effectAllowed="move";
    event.dataTransfer.setData("text/plain",dragKey);
  });
  root.addEventListener("dragend",event=>{
    event.target.closest("[data-project-card]")?.classList.remove("dragging");
    root.querySelectorAll(".drag-over").forEach(node=>node.classList.remove("drag-over"));
    dragKey="";
  });
  root.addEventListener("dragover",event=>{
    if(!positionMode||!dragKey)return;
    const over=event.target.closest("[data-project-card]");
    const dragging=root.querySelector(`[data-project-card="${CSS.escape(dragKey)}"]`);
    if(!over||!dragging||over===dragging)return;
    event.preventDefault();
    const rect=over.getBoundingClientRect();
    const after=event.clientY>rect.top+rect.height/2;
    over.parentElement.insertBefore(dragging,after?over.nextSibling:over);
  });
  root.addEventListener("drop",event=>{
    if(!positionMode||!dragKey)return;
    event.preventDefault();
    persistCurrentOrder();
  });
}

export function initProjects(){
  $("#projectPrev").addEventListener("click",()=>page>1&&load(page-1));
  $("#projectNext").addEventListener("click",()=>page<pages&&load(page+1));
  $("#projectSourceFilter").addEventListener("change",()=>{if(positionMode)return;page=1;load(1)});
  $("#projectSearch").addEventListener("input",debounce(()=>{if(positionMode)return;page=1;load(1)},300));
  $("#addProjectButton").addEventListener("click",()=>openProjectEditor());
  $("#editProjectPositionButton").addEventListener("click",togglePositionMode);
  $("#projectForm").addEventListener("submit",saveProject);
  $("#projectImageFiles").addEventListener("change",event=>{
    for(const file of event.target.files){
      if(galleryItems.length>=12){window.UI.toast("A project can have up to 12 images.",{title:"Project images",type:"error"});break;}
      if(!validFile(file))continue;
      galleryItems.push({file,preview:URL.createObjectURL(file),name:file.name});
    }
    event.target.value="";renderGallery();
  });
  $("#projectLogoFile").addEventListener("change",event=>{
    const file=event.target.files[0];logoFile=file&&validFile(file)?file:null;
    if(!logoFile)event.target.value="";
  });
  $("#addProjectImageURL").addEventListener("click",()=>{
    const input=$("#projectImageURL"),value=input.value.trim();
    if(galleryItems.length>=12){window.UI.toast("A project can have up to 12 images.",{title:"Project images",type:"error"});return;}
    const valid=value.startsWith("/assets/")||value.startsWith("/api/public/project-media/")||/^https:\/\//i.test(value);
    if(!valid||!window.PublicStore.safeURL(value,{image:true})){window.UI.toast("Use an HTTPS image URL or an /assets/ path.",{title:"Project images",type:"error"});return;}
    galleryItems.push({url:value,preview:assetURL(value),name:value.split("/").pop()});input.value="";renderGallery();
  });
  $("#projectImageEditor").addEventListener("click",event=>{
    const button=event.target.closest("[data-gallery-action]");if(!button)return;
    const index=Number(button.dataset.index),action=button.dataset.galleryAction;
    if(action==="remove"){const [removed]=galleryItems.splice(index,1);if(removed?.preview?.startsWith("blob:"))URL.revokeObjectURL(removed.preview);}
    else{const other=index+(action==="left"?-1:1);if(other<0||other>=galleryItems.length)return;[galleryItems[index],galleryItems[other]]=[galleryItems[other],galleryItems[index]];}
    renderGallery();
  });
  initDrag();

  $("#projectRecords").addEventListener("click",async e=>{
    const move=e.target.closest("[data-move-project]");
    if(move){moveCard(move.dataset.projectKey,move.dataset.moveProject);return}
    const visible=e.target.closest("[data-project-visible]"),ping=e.target.closest("[data-project-ping]"),edit=e.target.closest("[data-project-edit]"),del=e.target.closest("[data-project-delete]");
    if(visible){
      visible.disabled=true;
      try{await window.APIManager.updateAdminProject(visible.dataset.projectVisible,{visible:visible.dataset.visible!=="true"});await load(page)}
      catch(error){window.UI.toast(error.message,{title:"Projects",type:"error"});visible.disabled=false}
    }
    if(ping){
      ping.disabled=true;ping.textContent="Checking…";
      try{
        const result=await window.APIManager.pingAdminProject(ping.dataset.projectPing);
        const badge=document.querySelector(`[data-status-key="${CSS.escape(ping.dataset.projectPing)}"]`);
        if(badge){badge.className=`project-live ${result.status}`;badge.innerHTML=`<i></i>${escapeHTML(result.status)}`}
        window.UI.toast(`Project is ${result.status}.`,{title:"Ping"});
      }catch(error){window.UI.toast(error.message,{title:"Ping",type:"error"})}
      finally{ping.disabled=false;ping.textContent="Ping"}
    }
    if(edit){
      const item=currentItems.find(x=>x.key===edit.dataset.projectEdit);
      if(item)openProjectEditor(item);
    }
    if(del){
      const item=currentItems.find(x=>x.key===del.dataset.projectDelete);
      if(!item)return;
      const confirmed=await confirmAction({title:"Delete project?",message:`Remove "${item.name}" from portfolio management? This cannot be undone.`,confirmLabel:"Delete project"});
      if(!confirmed)return;
      del.disabled=true;
      try{
        await window.APIManager.deleteAdminProject(item.key);
        window.UI.toast("Project removed.",{title:"Projects"});
        await load(page);
      }catch(error){window.UI.toast(error.message,{title:"Projects",type:"error"});del.disabled=false}
    }
  });
}
export function loadProjects(force=false){if(!loaded||force)return load(page)}
