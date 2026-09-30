import {$,escapeHTML,debounce,setEmpty,openModal,closeModal,confirmAction} from "./helpers.js";

const MAX_IMAGE_BYTES=5*1024*1024;
const IMAGE_FILE_PATTERN=/\.(?:jpe?g|jfif|png|gif|webp)$/i;
let page=1,pages=1,loaded=false,currentItems=[],selectedFile=null,originalSourceURL="",dragDepth=0,urlPreviewTimer=null;

function formatCertificateDate(value){
  const match=String(value||"").match(/^(\d{4})/);
  return match?match[1]:"Year unavailable";
}

function renderItem(item){
  return `<article class="certificate-management-card ${item.pinned?"is-pinned":""} ${item.visible?"":"is-hidden"}">
    <div class="certificate-management-image"><img src="${escapeHTML(window.PublicStore.apiURL(item.image_url))}" alt="Certificate from ${escapeHTML(item.provider)}" loading="lazy"></div>
    <div class="certificate-management-body">
      <div class="certificate-management-heading"><div><h3>${escapeHTML(item.provider)}</h3><time datetime="${escapeHTML(item.date)}">${escapeHTML(formatCertificateDate(item.date))}</time></div><div class="certificate-statuses">${item.pinned?`<span class="certificate-admin-pin">Pinned</span>`:""}<span class="certificate-admin-visibility ${item.visible?"shown":"hidden"}">${item.visible?"Shown":"Hidden"}</span></div></div>
      <div class="certificate-management-actions">
        <button class="record-action ${item.visible?"primary":""}" type="button" data-certificate-visible="${item.id}">${item.visible?"Hide":"Show"}</button>
        <button class="record-action ${item.pinned?"primary":""}" type="button" data-certificate-pin="${item.id}">${item.pinned?"Unpin":"Pin"}</button>
        <button class="record-action" type="button" data-certificate-edit="${item.id}">Edit</button>
        <button class="record-action danger" type="button" data-certificate-delete="${item.id}">Delete</button>
      </div>
    </div>
  </article>`;
}

async function load(target=page){
  const root=$("#certificateRecords");
  root.innerHTML=`<div class="inline-loading"><span class="spinner" aria-hidden="true"></span><span>Loading certificates…</span></div>`;
  try{
    const data=await window.APIManager.getAdminCertificates({page:target,status:$("#certificateStatusFilter").value,q:$("#certificateSearch").value.trim()});
    page=Number(data.page||1);pages=Math.max(1,Number(data.total_pages||1));loaded=true;currentItems=data.items||[];
    if(!currentItems.length)setEmpty(root,"No certificates match this view.");
    else root.innerHTML=currentItems.map(renderItem).join("");
    $("#certificateAdminPage").textContent=`Page ${page} of ${pages} · ${data.total||0} certificates`;
    $("#certificateAdminPrev").disabled=page<=1;$("#certificateAdminNext").disabled=page>=pages;
  }catch(error){setEmpty(root,error.message);window.UI.toast(error.message,{title:"Certificates",type:"error"})}
}

function resetPreview(){
  selectedFile=null;
  const fileInput=$("#certificateImage");if(fileInput)fileInput.value="";
  const preview=$("#certificateImagePreview");preview.hidden=true;preview.removeAttribute("src");
  $("#certificateUploadCopy").hidden=false;
  $("#certificateUploadStatus").textContent="No image selected.";
}


function fileToDataURL(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error("Unable to preview this image."));
    reader.readAsDataURL(file);
  });
}

function showPreview(src,label){
  const preview=$("#certificateImagePreview");
  preview.src=window.PublicStore.apiURL(src);preview.hidden=false;$("#certificateUploadCopy").hidden=true;
  $("#certificateUploadStatus").textContent=label;
}

function openEditor(item=null){
  $("#certificateForm").reset();resetPreview();
  $("#certificateId").value=item?.id||"";
  $("#certificateModalTitle").textContent=item?"Edit certificate":"Add certificate";
  $("#certificateDate").value=formatCertificateDate(item?.date)==="Year unavailable"?"":formatCertificateDate(item?.date);
  $("#certificateProvider").value=item?.provider||"";
  $("#certificateVisible").checked=item?.visible!==false;
  $("#certificatePinned").checked=Boolean(item?.pinned);
  $("#certificateImageURL").value=item?.source_url||"";
  originalSourceURL=item?.source_url||"";
  if(item?.image_url)showPreview(`${window.PublicStore.apiURL(item.image_url)}?v=${Date.now()}`,"Current stored image. Drop or choose another image to replace it.");
  openModal("certificateModal");
}

async function loadImageSource(file){
  if(typeof createImageBitmap==="function")return createImageBitmap(file);
  const src=URL.createObjectURL(file);
  try{
    const image=new Image();
    image.decoding="async";
    image.src=src;
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("Unable to read this image."))});
    return image;
  }finally{URL.revokeObjectURL(src)}
}

async function compressImage(file){
  if(file.size<=MAX_IMAGE_BYTES)return file;
  if(!isImageFile(file))throw new Error("Choose an image file.");
  const source=await loadImageSource(file);
  let width=source.width,height=source.height,quality=.9;
  for(let pass=0;pass<10;pass++){
    const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(width));canvas.height=Math.max(1,Math.round(height));
    const ctx=canvas.getContext("2d",{alpha:false});ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",quality));
    if(blob&&blob.size<=MAX_IMAGE_BYTES){source.close?.();return new File([blob],`${file.name.replace(/\.[^.]+$/,"")||"certificate"}.jpg`,{type:"image/jpeg",lastModified:Date.now()})}
    width*=.84;height*=.84;quality=Math.max(.62,quality-.04);
  }
  source.close?.();
  throw new Error("Unable to reduce this image below 5 MB without making it too small.");
}

function isImageFile(file){
  if(!file)return false;
  return String(file.type||"").startsWith("image/")||IMAGE_FILE_PATTERN.test(String(file.name||""));
}

function previewURL(raw){
  const url=String(raw||"").trim();
  if(urlPreviewTimer){clearTimeout(urlPreviewTimer);urlPreviewTimer=null}
  if(!url){
    if(!selectedFile)resetPreview();
    return;
  }
  if(selectedFile)resetPreview();
  $("#certificateUploadStatus").textContent="Checking image URL…";
  urlPreviewTimer=setTimeout(()=>{
    const preview=$("#certificateImagePreview");
    const src=`/api/admin/certificates/preview?url=${encodeURIComponent(url)}&v=${Date.now()}`;
    preview.onload=()=>{preview.onload=null;preview.onerror=null;preview.hidden=false;$("#certificateUploadCopy").hidden=true;$("#certificateUploadStatus").textContent="Image URL preview · the image will be copied into managed media storage when saved."};
    preview.onerror=()=>{preview.onload=null;preview.onerror=null;preview.hidden=true;preview.removeAttribute("src");$("#certificateUploadCopy").hidden=false;$("#certificateUploadStatus").textContent="Unable to preview this URL. Check that it points directly to a public image."};
    preview.src=window.PublicStore.apiURL(src);
  },450);
}

async function setSelectedFile(file){
  if(!isImageFile(file)){window.UI.toast("Drop or choose a JPG, PNG, GIF, or WebP image.",{title:"Certificates",type:"error"});return}
  $("#certificateUploadStatus").textContent=file.size>MAX_IMAGE_BYTES?"Reducing image below 5 MB…":"Preparing image…";
  try{
    const ready=await compressImage(file);selectedFile=ready;
    $("#certificateImageURL").value="";
    const previewDataURL=await fileToDataURL(ready);
    showPreview(previewDataURL,`${ready.name} · ${(ready.size/1024/1024).toFixed(2)} MB ready to upload`);
  }catch(error){resetPreview();window.UI.toast(error.message,{title:"Image processing",type:"error"})}
}

async function saveCertificate(event){
  event.preventDefault();
  const id=$("#certificateId").value;
  const url=$("#certificateImageURL").value.trim();
  if(!id&&!selectedFile&&!url){window.UI.toast("Add a certificate image or image URL.",{title:"Certificates",type:"error"});return}
  const form=new FormData();
  form.append("date",$("#certificateDate").value);
  form.append("provider",$("#certificateProvider").value.trim());
  form.append("visible",String($("#certificateVisible").checked));
  form.append("pinned",String($("#certificatePinned").checked));
  if(selectedFile)form.append("image",selectedFile,selectedFile.name);
  else if(url&&url!==originalSourceURL)form.append("image_url",url);
  else if(!id&&url)form.append("image_url",url);

  const button=$("#saveCertificateButton");window.UI.setButtonLoading(button,true,"Saving…");
  try{
    if(id)await window.APIManager.updateAdminCertificate(id,form);else await window.APIManager.addAdminCertificate(form);
    closeModal("certificateModal");resetPreview();
    window.UI.toast(id?"Certificate updated.":"Certificate added.",{title:"Certificates"});
    page=id?page:1;await load(page);
  }catch(error){window.UI.toast(error.message,{title:"Certificates",type:"error"})}
  finally{window.UI.setButtonLoading(button,false)}
}

function dragHasFiles(event){
  const items=[...(event.dataTransfer?.items||[])];
  return items.length?items.some(item=>item.kind==="file"):Boolean(event.dataTransfer?.types&&[...event.dataTransfer.types].includes("Files"));
}
function acceptsViewportDrop(){return $("#view-certificates")?.classList.contains("active")||!$("#certificateModal")?.hidden}
function droppedImage(event){return [...(event.dataTransfer?.files||[])].find(isImageFile)||null}

function initViewportDrop(){
  const overlay=$("#certificateDropOverlay");
  document.addEventListener("dragenter",event=>{
    if(!acceptsViewportDrop()||!dragHasFiles(event))return;
    event.preventDefault();dragDepth++;overlay.hidden=false;
  });
  document.addEventListener("dragover",event=>{
    if(!acceptsViewportDrop()||!dragHasFiles(event))return;
    event.preventDefault();event.dataTransfer.dropEffect="copy";overlay.hidden=false;
  });
  document.addEventListener("dragleave",event=>{
    if(!acceptsViewportDrop())return;
    dragDepth=Math.max(0,dragDepth-1);if(dragDepth===0)overlay.hidden=true;
  });
  document.addEventListener("drop",event=>{
    if(!acceptsViewportDrop()||!dragHasFiles(event))return;
    event.preventDefault();dragDepth=0;overlay.hidden=true;
    const file=droppedImage(event);
    if(!file){window.UI.toast("Drop a JPG, PNG, GIF, or WebP image.",{title:"Certificates",type:"error"});return}
    if($("#certificateModal").hidden)openEditor();
    setSelectedFile(file);
  });
}

export function initCertificates(){
  $("#certificateAdminPrev").addEventListener("click",()=>page>1&&load(page-1));
  $("#certificateAdminNext").addEventListener("click",()=>page<pages&&load(page+1));
  $("#certificateStatusFilter").addEventListener("change",()=>{page=1;load(1)});
  $("#certificateSearch").addEventListener("input",debounce(()=>{page=1;load(1)},300));
  $("#addCertificateButton").addEventListener("click",()=>openEditor());
  $("#certificateForm").addEventListener("submit",saveCertificate);
  const uploadZone=$("#certificateUploadZone");
  const fileInput=$("#certificateImage");
  uploadZone.addEventListener("click",event=>{
    // The input is inside this zone. Ignore its bubbled synthetic click to avoid desktop click recursion.
    if(event.target===fileInput)return;
    fileInput.click();
  });
  uploadZone.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();fileInput.click()}});
  fileInput.addEventListener("click",event=>event.stopPropagation());
  fileInput.addEventListener("change",event=>{const file=event.target.files?.[0];if(file)setSelectedFile(file)});
  $("#certificateImageURL").addEventListener("input",event=>previewURL(event.target.value));
  initViewportDrop();

  $("#certificateRecords").addEventListener("click",async event=>{
    const visible=event.target.closest("[data-certificate-visible]");
    const pin=event.target.closest("[data-certificate-pin]");
    const edit=event.target.closest("[data-certificate-edit]");
    const del=event.target.closest("[data-certificate-delete]");
    const id=visible?.dataset.certificateVisible||pin?.dataset.certificatePin||edit?.dataset.certificateEdit||del?.dataset.certificateDelete;
    const item=currentItems.find(entry=>String(entry.id)===String(id));if(!item)return;
    if(visible){
      visible.disabled=true;
      try{await window.APIManager.setAdminCertificateState(item.id,{visible:!item.visible});window.UI.toast(item.visible?"Certificate hidden.":"Certificate shown.",{title:"Certificates"});await load(page)}
      catch(error){window.UI.toast(error.message,{title:"Certificates",type:"error"});visible.disabled=false}
    }
    if(pin){
      pin.disabled=true;
      try{await window.APIManager.setAdminCertificateState(item.id,{pinned:!item.pinned});window.UI.toast(item.pinned?"Certificate unpinned.":"Certificate pinned first.",{title:"Certificates"});await load(page)}
      catch(error){window.UI.toast(error.message,{title:"Certificates",type:"error"});pin.disabled=false}
    }
    if(edit)openEditor(item);
    if(del){
      const confirmed=await confirmAction({title:"Delete certificate?",message:`Delete the certificate from ${item.provider}? The stored image will also be removed from the database.`,confirmLabel:"Delete certificate"});
      if(!confirmed)return;
      del.disabled=true;
      try{await window.APIManager.deleteAdminCertificate(item.id);window.UI.toast("Certificate deleted.",{title:"Certificates"});await load(page)}
      catch(error){window.UI.toast(error.message,{title:"Certificates",type:"error"});del.disabled=false}
    }
  });
}

export function loadCertificates(force=false){if(!loaded||force)return load(page)}
