import {$,$$,formatDate,openModal,closeModal,confirmAction} from "./helpers.js";
let loaded=false,original="",challenge=null,challengeTimer=null,version=0,saving=false;

function updateEditorMeta(){
  const editor=$("#informationEditor"),lines=$("#editorLines"),state=$("#jsonState"),save=$("#saveInformationButton");
  const count=Math.max(1,editor.value.split("\n").length);lines.textContent=Array.from({length:count},(_,i)=>i+1).join("\n");lines.scrollTop=editor.scrollTop;
  let valid=false,errorText="";try{JSON.parse(editor.value);valid=true}catch(error){errorText=String(error?.message||"Invalid JSON").replace(/^JSON\.parse:\s*/,"")}
  state.textContent=valid?(editor.value===original?"Valid JSON · unchanged":"Valid JSON · unsaved changes"):`JSON error · ${errorText}`;
  state.className=`json-state ${valid?"valid":"invalid"}`;save.disabled=!valid||editor.value===original||window.ServerStatus?.online!==true;
  const before=editor.value.slice(0,editor.selectionStart),parts=before.split("\n");$("#editorPosition").textContent=`Ln ${parts.length}, Col ${parts.at(-1).length+1}`;
}
async function load(){
  try{
    const data=await window.APIManager.getAdminInformation();loaded=true;version=Number(data.version||0);original=data.content||"";$("#informationEditor").value=original;$("#informationModified").textContent=data.modified_at?`Modified ${formatDate(data.modified_at)}`:"Loaded";updateEditorMeta();
  }catch(error){window.UI.toast(error.message,{title:"Information",type:"error"});$("#jsonState").textContent="Unable to load";$("#jsonState").className="json-state invalid"}
}
function clearChallenge(){
  clearInterval(challengeTimer);challenge=null;$("#saveChallengeCells").innerHTML="";$("#saveChallengeProgress").style.width="0%";closeModal("informationChallengeModal");
}
function cellValue(){return $$(".save-challenge-cell").map(i=>i.value).join("")}
function focusCell(index){const cells=$$(".save-challenge-cell");cells[Math.max(0,Math.min(cells.length-1,index))]?.focus()}
function updateChallengeProgress(){
  if(!challenge)return;const cells=$$(".save-challenge-cell");let correct=0;
  cells.forEach((cell,i)=>{cell.classList.remove("correct","wrong");if(!cell.value)return;if(cell.value===challenge.value[i]){cell.classList.add("correct");correct++}else cell.classList.add("wrong")});
  $("#saveChallengeProgress").style.width=`${(correct/challenge.value.length)*100}%`;$("#confirmInformationSave").disabled=cellValue()!==challenge.value;
}
async function openChallenge(){
  if($("#saveInformationButton").disabled)return;
  try{
    const data=await window.APIManager.createInformationChallenge();challenge={id:data.challenge_id,value:data.challenge,expires:new Date(data.expires_at).getTime()};$("#saveChallengeValue").textContent=data.challenge;
    const root=$("#saveChallengeCells");root.innerHTML=Array.from({length:20},(_,i)=>`<input class="save-challenge-cell" maxlength="1" autocomplete="off" spellcheck="false" aria-label="Challenge character ${i+1}">`).join("");
    root.querySelectorAll("input").forEach((input,i)=>{
      ["paste","drop"].forEach(type=>input.addEventListener(type,e=>e.preventDefault()));
      input.addEventListener("input",()=>{if(input.value.length>1)input.value=input.value.slice(-1);updateChallengeProgress();if(input.value)focusCell(i+1)});
      input.addEventListener("keydown",e=>{if(e.key==="Backspace"&&!input.value){e.preventDefault();focusCell(i-1)}if(e.key==="ArrowLeft")focusCell(i-1);if(e.key==="ArrowRight")focusCell(i+1)});
    });
    openModal("informationChallengeModal");focusCell(0);updateChallengeProgress();
    clearInterval(challengeTimer);const tick=()=>{const diff=Math.max(0,challenge.expires-Date.now()),s=Math.ceil(diff/1000);$("#saveChallengeTimer").textContent=`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;if(diff<=0){clearInterval(challengeTimer);$("#confirmInformationSave").disabled=true;window.UI.toast("The save challenge expired. Generate a new one.",{title:"Information",type:"error"})}};tick();challengeTimer=setInterval(tick,1000);
  }catch(error){window.UI.toast(error.message,{title:"Information",type:"error"})}
}
async function save(){
  if(!challenge||cellValue()!==challenge.value)return;const button=$("#confirmInformationSave");saving=true;window.UI.setButtonLoading(button,true,"Saving…");
  try{
    const result=await window.APIManager.saveAdminInformation({content:$("#informationEditor").value,challenge_id:challenge.id,key:cellValue(),version});
    version=Number(result.version||version+1);original=$("#informationEditor").value;$("#informationModified").textContent=`Saved ${formatDate(result.saved_at)}`;updateEditorMeta();clearChallenge();window.UI.toast("Portfolio information saved. Connected pages are updating.",{title:"Information"})
  }catch(error){window.UI.toast(error.message,{title:"Information",type:"error"});clearChallenge()}finally{saving=false;window.UI.setButtonLoading(button,false);updateEditorMeta()}
}
export function initInformation(){
  const editor=$("#informationEditor");
  document.addEventListener("portfolio:content-updated",()=>{
    if(!loaded||saving||window.ServerStatus?.online!==true)return;
    if(editor.value===original)void load();
    else $("#informationModified").textContent="Portfolio updated. Your unsaved edit is preserved; refresh before saving conflicting changes.";
  });
  document.addEventListener("portfolio:server-status",updateEditorMeta);
  addEventListener("beforeunload",event=>{if(loaded&&editor.value!==original){event.preventDefault();event.returnValue="";}});
  editor.addEventListener("input",updateEditorMeta);editor.addEventListener("click",updateEditorMeta);editor.addEventListener("keyup",updateEditorMeta);editor.addEventListener("scroll",()=>{$("#editorLines").scrollTop=editor.scrollTop});
  editor.addEventListener("keydown",e=>{if(e.key==="Tab"){e.preventDefault();const s=editor.selectionStart,end=editor.selectionEnd;editor.setRangeText("  ",s,end,"end");updateEditorMeta()}});
  $("#saveInformationButton").addEventListener("click",openChallenge);$("#confirmInformationSave").addEventListener("click",save);
  document.querySelectorAll('[data-close-modal="informationChallengeModal"]').forEach(b=>b.addEventListener("click",()=>{clearInterval(challengeTimer);challenge=null}));
}
export async function loadInformation(force=false){
  if(loaded&&$("#informationEditor").value!==original){
    if(!force)return;
    if(!await confirmAction({title:"Reload information?",message:"Your unsaved edits will be discarded and replaced with the latest saved information.",confirmLabel:"Reload",cancelLabel:"Keep editing"}))return;
  }
  if(!loaded||force)return load();
}
