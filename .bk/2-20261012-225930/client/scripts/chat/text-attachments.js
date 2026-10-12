/* Visitor text attachments: decoded locally and inserted into the existing
 * text-only composer. No binary file is uploaded to Go or Supabase. */
const permitted=new Set(['txt','md','markdown','html','css','js','ts','json','csv','xml','yaml','yml','log','docx']);
function u16(v,o){return v.getUint16(o,true)}
function u32(v,o){return v.getUint32(o,true)}
async function unzipDocumentXml(buffer){
  const v=new DataView(buffer), bytes=new Uint8Array(buffer);
  let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--){if(u32(v,i)===0x06054b50){end=i;break}}
  if(end<0)throw Error('Invalid Word document (ZIP directory missing).');
  const total=Math.min(200,u16(v,end+10)),off=u32(v,end+16);
  let p=off;
  for(let i=0;i<total&&p+46<=bytes.length;i++){
    if(u32(v,p)!==0x02014b50)break;
    const method=u16(v,p+10),compressed=u32(v,p+20),expanded=u32(v,p+24),nameLength=u16(v,p+28),extraLength=u16(v,p+30),commentLength=u16(v,p+32),localOff=u32(v,p+42);
    const name=new TextDecoder().decode(bytes.slice(p+46,p+46+nameLength));
    p+=46+nameLength+extraLength+commentLength;
    if(name!=='word/document.xml')continue;
    if(expanded>3*1024*1024||compressed>2*1024*1024||localOff+30>bytes.length||u32(v,localOff)!==0x04034b50)throw Error('Document exceeds the safe extraction limit.');
    const at=localOff+30+u16(v,localOff+26)+u16(v,localOff+28);
    if(at+compressed>bytes.length)throw Error('Invalid document archive.');
    const raw=bytes.slice(at,at+compressed);
    if(method===0)return new TextDecoder().decode(raw);
    if(method!==8||typeof DecompressionStream!=='function')throw Error('DOCX decompression is not supported in this browser.');
    let stream;
    try{stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))}
    catch{throw Error('Your browser does not support reading compressed DOCX. Use .txt or .md.')}
    const reader=stream.getReader(),chunks=[];let count=0;
    while(true){const {done,value}=await reader.read();if(done)break;count+=value.length;if(count>3*1024*1024){await reader.cancel();throw Error('DOCX text exceeds the safe extraction limit.')}chunks.push(value)}
    return new TextDecoder().decode(new Blob(chunks).size?await new Blob(chunks).arrayBuffer():new Uint8Array());
  }
  throw Error('The file has no Word document text.');
}
export async function extractAttachmentText(file){
  if(!file||file.size>4*1024*1024)throw Error('Text attachments must be 4 MB or smaller.');
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(!permitted.has(ext))throw Error('Supported: TXT, MD, HTML, CSS, JS, JSON, CSV, XML, and DOCX.');
  let text;
  if(ext==='docx'){
    const xml=await unzipDocumentXml(await file.arrayBuffer());
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror'))throw Error('Invalid Word XML.');
    const paragraphs=[...doc.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p')];
    text=paragraphs.map(p=>[...p.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')].map(t=>t.textContent).join('')).join('\n');
  }else text=await file.text();
  text=text.replace(/\0/g,'').trim();if(!text)throw Error('No readable text found.');
  return {ext,text,filename:file.name.replace(/[\r\n\t]/g,' ').slice(0,90)};
}
async function insertTextAttachment(input, file){
 const content=await extractAttachmentText(file),remaining=Math.max(0,Number(input.maxLength)||1800);
 const prefix=`**Attachment: ${content.filename.replace(/[\[\]*_`]/g,'')}**\n\n\`\`\`${content.ext}\n`;
 const suffix='\n\`\`\`';const limit=Math.max(0,remaining-prefix.length-suffix.length-26);
 const existing=input.value.trim();const available=Math.max(0,limit-existing.length-(existing?2:0));
 const displayed=content.text.slice(0,available);
 input.value=`${existing?existing+'\n\n':''}${prefix}${displayed}${suffix}`.slice(0,remaining);
 input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();
 if(content.text.length>displayed.length)window.UI?.toast?.('Only a preview fits in chat. The rest was not sent.',{title:'Attachment truncated',type:'error'});
 else window.UI?.toast?.('Document text inserted locally. Review it before sending.',{title:'Text ready'});
}
export function bindTextAttachment(input,fileInput,button){
 if(!input||!fileInput||!button)return;
 button.addEventListener('click',()=>fileInput.click());
 fileInput.addEventListener('change',async()=>{
  const file=fileInput.files?.[0];if(!file)return;
  button.disabled=true;
  try{await insertTextAttachment(input,file)}catch(err){window.UI?.toast?.(err.message,{title:'Attachment',type:'error'})}
  finally{button.disabled=false;fileInput.value=''}
 });
}
// Local drag-and-drop (no binary upload). Only accepted files are read; dropping
// other files is intercepted so they cannot navigate away from a live chat.
export function bindChatDrop(input,dropTarget,onImage=null){
 if(!input||!dropTarget||dropTarget.dataset.dropBound)return;
 dropTarget.dataset.dropBound='1';let depth=0;
 function hasFiles(e){return Array.from(e.dataTransfer?.types||[]).includes('Files')}
 dropTarget.addEventListener('dragenter',e=>{if(!hasFiles(e))return;e.preventDefault();depth++;dropTarget.classList.add('chat-drop-ready')});
 dropTarget.addEventListener('dragover',e=>{if(!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy'});
 dropTarget.addEventListener('dragleave',e=>{if(!hasFiles(e))return;depth=Math.max(0,depth-1);if(depth===0)dropTarget.classList.remove('chat-drop-ready')});
 dropTarget.addEventListener('drop',async e=>{
  if(!hasFiles(e))return;e.preventDefault();depth=0;dropTarget.classList.remove('chat-drop-ready');
  const file=e.dataTransfer?.files?.[0];if(!file)return;
  if(file.type?.startsWith('image/')&&typeof onImage==='function'){await onImage(file);return}
  try{await insertTextAttachment(input,file)}catch(err){window.UI?.toast?.(err.message,{title:'Attachment',type:'error'})}
 });
}
