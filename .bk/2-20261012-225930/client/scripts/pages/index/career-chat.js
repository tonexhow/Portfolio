import {initCustomControls,confirmChatClear} from "../../ui/ui-enhancements.js";
import {renderChatMarkdown,wireChatCopy} from "../../chat/chat-markdown.js";
import {loadBotHistory,saveBotMessage,clearBotHistory} from "../../chat/bot-history.js";
import {bindChatComposer} from "../../chat/chat-composer.js";
import {bindTextAttachment,bindChatDrop} from "../../chat/text-attachments.js";
import {bindSlashCommands,parseQuickCommand,openCommandHelp} from "../../chat/slash-commands.js";
import {renderAdminRichMessage} from "../../chat/admin-image.js";
import {openVisitorCreateProject,openVisitorProjects} from "../../chat/project-inquiries.js";
import {offerCard,loadOffers,removeArchivedOffer} from "../../chat/project-offers.js";
import {understandUiCommand,parseUiRequest,executeUiCommand,commonActions} from "../../chat/tonex-actions.js";
import {pricingRequest,pricingDiscovery,pricingScope} from "../../chat/pricing-guidance.js";
import {variation} from "../../chat/response-variants.js";
import {selectIntroPortrait,introductionFromPublished,introductionCardData} from "../../chat/introduction.js";
const $ = s => document.querySelector(s);
let chatSocket=null,statusTimer=null,chatStarted=false,ownerName="Jhon Anthony Pano",closeTimer=null,chatReconnectTimer=null;
let mode="bot",status={available:false,admin_online:false,identity:{},transport_online:false},liveStarted=false;
let guestHistory=[],liveThread="",botReady=false,botBusy=false,aiOnline=false,aiConfigured=false,previousTheme="";
function escapeText(v){const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML}
function docLabel(type){return type==="cv"?"Curriculum Vitae":type==="biodata"?"Biodata":"Resume"}
function renderCareer(items){
  const list=$("#careerProfileList"); if(!list)return;
  if(!items?.length){list.innerHTML='<div class="empty-state">No Career Profile documents are published yet.</div>';return}
  list.innerHTML=items.map(x=>`<article class="career-doc"><div class="career-doc-icon">${x.document_type==="cv"?"CV":x.document_type==="biodata"?"BIO":"R"}</div><div><h3>${escapeText(x.title||docLabel(x.document_type))}</h3><p>${escapeText(x.description||docLabel(x.document_type))}</p><small>${escapeText(docLabel(x.document_type))} · Updated ${new Date(x.updated_at).toLocaleDateString()}</small></div><div class="career-doc-actions"><a href="${escapeText(x.storage_url)}" target="_blank" rel="noopener">Preview</a><a class="primary" href="${escapeText(x.storage_url)}?download" download>Download</a></div></article>`).join("");
}
export function initCareerProfile(){
  const modal=$("#careerProfileModal"),open=$("#careerProfileButton"),close=$("#careerProfileClose"); if(!modal||!open)return;
  const refresh=async()=>{const data=await window.PublicStore.init();renderCareer(data.career_profiles||[])};
  open.addEventListener("click",async()=>{await refresh();modal.showModal()});
  close?.addEventListener("click",()=>modal.close());
  modal.addEventListener("click",e=>{if(e.target===modal)modal.close()});
  document.addEventListener("portfolio:content-updated",refresh);
}
const markdown = (text,allowImages=false) => `<div class="chat-message-markdown">${renderChatMarkdown(text,{allowImages})}</div>`;
function drawMessage(container,m,kind){
  if(!container||!m)return;
  const id=String(m.id||"");
  if(id&&Array.from(container.children).some(n=>n.dataset.chatId===id))return;
  const el=document.createElement("article");
  el.className=`chat-bubble ${kind==="bot"?(m.sender==="visitor"?"visitor":"bot"):m.sender}`;
  el.dataset.chatId=id;const time=m.created_at||m.createdAt||Date.now();
  // Only messages tagged Admin by the server may display remote image embeds.
  // All other messages, including visitor and AI output, remain safe Markdown.
  const isRich=kind==='live'&&m.sender==='admin';
  el.innerHTML=`${isRich?'':markdown(m.body,false)}<time datetime="${escapeText(new Date(time).toISOString())}">${new Date(time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}</time>`;
  if(isRich)el.insertBefore(renderAdminRichMessage(m.sender,m.body,renderChatMarkdown),el.querySelector('time'));
  // Rich Bot results are references to already-published website records.
  // Never inject AI-generated HTML or unverified image URLs into chat.
  if(kind==="bot"&&m.sender==="bot"&&Array.isArray(m.projectKeys)){
    const projects=window.PublicStore?.current?.projects||[];
    const matches=m.projectKeys.slice(0,4).map(key=>projects.find(p=>p.key===key&&p.visible!==false)).filter(Boolean);
    if(matches.length){
      const gallery=document.createElement("div");gallery.className="bot-project-results";
      for(const project of matches){
        const link=document.createElement("a");link.href="#projects";link.className="bot-project-result";
        link.addEventListener("click", event=>{
          if(!document.querySelector("#projectViewer"))return;
          event.preventDefault();
          document.dispatchEvent(new CustomEvent("portfolio:open-project",{detail:{key:project.key,trigger:link}}));
        });
        const image=project.images?.[0]||project.icon;
        if(image){
          const thumb=document.createElement("img");thumb.alt="";thumb.loading="lazy";thumb.decoding="async";
          thumb.src=window.PublicStore.mediaURL(image);link.append(thumb);
        }
        const meta=document.createElement("span");const heading=document.createElement("strong");heading.textContent=project.name;
        const details=document.createElement("small");details.textContent=(project.stack||[]).slice(0,4).join(" · ")||project.type||"Published project";
        meta.append(heading,details);link.append(meta);gallery.append(link);
      }
      el.append(gallery);
    }
  }
  if(kind==="bot"&&m.sender==="bot"){
    const content=window.PublicStore?.current||{};
    if(Array.isArray(m.certificateIds)&&m.certificateIds.length){
      const list=document.createElement("div");list.className="bot-project-results";
      for(const id of m.certificateIds.slice(0,3)){
        const certificate=(content.certificates||[]).find(c=>String(c.id)===String(id));if(!certificate)continue;
        const card=document.createElement("a");card.href="#certificates";card.className="bot-project-result";
        const image=document.createElement("img");image.alt="";image.loading="lazy";image.src=window.PublicStore.mediaURL(certificate.image_url);
        const meta=document.createElement("span"),name=document.createElement("strong"),date=document.createElement("small");
        name.textContent=certificate.provider||"Certificate";date.textContent=certificate.date||"View certificate";
        meta.append(name,date);card.append(image,meta);
        card.addEventListener("click",e=>{e.preventDefault();closeChat();document.dispatchEvent(new CustomEvent("portfolio:open-certificate",{detail:{id:certificate.id}}))});
        list.append(card);
      }if(list.childElementCount)el.append(list);
    }
    if(Array.isArray(m.documentIds)&&m.documentIds.length){
      const list=document.createElement("div");list.className="bot-project-results";
      for(const id of m.documentIds.slice(0,3)){
        const doc=(content.career_profiles||[]).find(d=>String(d.id)===String(id));if(!doc)continue;
        const card=document.createElement("a");card.className="bot-project-result";card.href="#career";
        const icon=document.createElement("span");icon.className="bot-file-icon";icon.textContent=(doc.document_type||"PDF").toUpperCase();
        const meta=document.createElement("span"),name=document.createElement("strong"),kind=document.createElement("small");
        name.textContent=doc.title||docLabel(doc.document_type);kind.textContent=doc.description||docLabel(doc.document_type);
        meta.append(name,kind);card.append(icon,meta);
        card.addEventListener("click",e=>{e.preventDefault();executeUiCommand({type:"navigate",target:"career"},{closeChat})});list.append(card);
      }if(list.childElementCount)el.append(list);
    }
    if(m.introCard){
      // Only published, first-party information is rendered; no user/AI HTML.
      const details=introductionCardData(content.information||{});
      const card=document.createElement("aside");card.className="bot-intro-card";
      const profiles=content.profiles?.items||content.information?.profile_images||[];
      if(m.profileImage&&profiles.includes(m.profileImage)){
        const photo=document.createElement("img");photo.alt=`Portrait of ${details.name}`;
        photo.loading="lazy";photo.decoding="async";photo.src=window.PublicStore.mediaURL(m.profileImage);
        card.append(photo);
      }
      const text=document.createElement("div");text.className="bot-intro-card-text";
      const eyebrow=document.createElement("small");eyebrow.textContent="Meet the developer";
      const title=document.createElement("strong");title.textContent=details.name;
      const role=document.createElement("span");role.textContent=details.role;
      text.append(eyebrow,title,role);
      if(details.location){const location=document.createElement("span");location.textContent=details.location;text.append(location)}
      if(details.availability){const tag=document.createElement("em");tag.textContent=details.availability;text.append(tag)}
      card.append(text);el.append(card);
    }
    const options=Array.isArray(m.actions)?m.actions:[];
    if(options.length){const row=document.createElement("div");row.className="bot-action-row";
      for(const action of options.slice(0,5)){
        if(!action||!['navigate','theme','live'].includes(action.type))continue;
        const button=document.createElement("button");button.type="button";button.textContent=String(action.label||'Open').slice(0,35);
        button.addEventListener("click",()=>executeUiCommand(action,{closeChat}));row.append(button);
      }
      if(row.childElementCount)el.append(row);
    }
  }
  container.append(el);container.scrollTop=container.scrollHeight;
}
function addLiveMessage(message){drawMessage($("#liveChatMessages"),message,"live")}
function addBotMessage(message){drawMessage($("#botChatMessages"),message,"bot")}
function panelIsOpen(){return !$("#liveChatPanel")?.hidden}
function closeChat(){
  const panel=$("#liveChatPanel"),launcher=$("#liveChatLauncher");if(!panel||panel.hidden)return;
  clearTimeout(closeTimer);document.documentElement.classList.remove("chat-overlay-open");panel.classList.remove("is-open");launcher?.classList.remove("is-open");launcher?.setAttribute("aria-expanded","false");
  closeTimer=setTimeout(()=>{panel.hidden=true},190);
}
function revealChat(){
  const panel=$("#liveChatPanel"),launcher=$("#liveChatLauncher");if(!panel)return;
  clearTimeout(closeTimer);panel.hidden=false;document.documentElement.classList.add("chat-overlay-open");launcher?.setAttribute("aria-expanded","true");
  requestAnimationFrame(()=>{panel.classList.add("is-open");launcher?.classList.add("is-open")});
}
function updateAvailability(){
  const online=!!status.admin_online, canChat=!!status.available;
  const launcher=$("#liveChatLauncher");
  if(launcher){launcher.disabled=false;launcher.dataset.online=String(online);launcher.title="Open Tonex Bot or Live Chat";launcher.setAttribute("aria-label",launcher.title)}
  const state=$("#liveChatState");
  if(state)state.textContent=mode==="bot"?(aiOnline?"Tonex is online":"Tonex is offline"):online?`${ownerName} is online`:canChat?"Leave a message · response later":liveStarted?"Admin offline · payments stay live":"Sign in to leave a message";
  const gate=$("#liveChatGate");if(gate)gate.hidden=mode!=="live"||canChat||liveStarted;
  const offlineServer=status.transport_online===false;
  const message=offlineServer?"Live messaging is temporarily unavailable. Tonex Bot can still help with published portfolio information.":"Verify an account to leave a message while the Admin is offline. Guests can message directly when the Admin returns.";
  const gateText=$("#liveChatGate p");if(gateText)gateText.textContent=message;
  const verify=$("#chatVerifyAccount");if(verify)verify.hidden=offlineServer;
  const note=$("#liveChatNote");if(note)note.textContent=offlineServer?"Live messages are temporarily unavailable. Tonex Bot can still help.":online?"Live now. Messages are retained for 7 days.":canChat?"You're verified. Leave a message and I'll reply when available.":liveStarted?"Admin is offline. Existing project payments still update automatically; messaging is paused.":"Sign in to leave a message while I am offline.";
  const input=$("#liveChatInput"),button=$("#liveChatForm button");
  if(input)input.disabled=mode!=="live"||!canChat||!liveStarted;
  if(button)button.disabled=mode!=="live"||!canChat||!liveStarted;
}
async function checkStatus(){
  try{status={...await window.APIManager.getChatStatus(),transport_online:true}}catch{status={available:false,admin_online:false,identity:{},transport_online:false}}
  updateAvailability();
  // Keep an existing guest's socket open for verified payment events even
  // when Admin signs out. Messaging remains disabled by updateAvailability.
  if(!status.available&&!liveStarted&&chatSocket){chatSocket.close();chatSocket=null}
  return status;
}
function setMode(next){
  mode=next;
  document.querySelectorAll("[data-chat-mode]").forEach(button=>{
    const selected=button.dataset.chatMode===next;
    button.setAttribute("aria-selected",String(selected));button.classList.toggle("active",selected);
  });
  $("#botChatPane").hidden=next!=="bot";
  $("#liveChatPane").hidden=next!=="live";
  updateAvailability();
  if(next==="live")void ensureLive();
  else $("#botChatInput")?.focus();
}
async function ensureLive(){
  await checkStatus();if(mode!=="live"||status.transport_online===false)return;
  if(liveStarted){updateAvailability();if(!chatSocket)connectChat();return}
  try{
    const session=await window.APIManager.openChatSession();
    $("#liveChatMessages").innerHTML="";
    liveThread=session.thread_id||"";
    (session.messages||[]).forEach(addLiveMessage);
    liveStarted=true;connectChat();void loadOffers($("#liveChatMessages"));updateAvailability();$("#liveChatInput")?.focus();
  }catch(error){
    // Existing chat cookies can be resumed while Admin is offline. A visitor
    // without a thread is still gated; don't repeatedly show an error toast.
    if(status.available)window.UI.toast(error.message,{title:"Live Chat",type:"error"});
    liveStarted=false;await checkStatus();
  }
}
function connectChat(){
  if(chatSocket&&chatSocket.readyState<2)return;
  const ws=new WebSocket(window.APIManager.chatWebSocketURL("/api/public/chat/ws"));chatSocket=ws;
  ws.onmessage=e=>{try{
    const data=JSON.parse(e.data);
    if(data.type==="message")addLiveMessage(data.message);
    if(data.type==="project_offer")offerCard(data.offer,$("#liveChatMessages"));
    if(data.type==="project_offer_archived")removeArchivedOffer(data.id,$("#liveChatMessages"));
    if(data.type==="availability"){status.admin_online=!!data.available;status.available=!!data.available||!!status.identity?.authenticated;updateAvailability()}
    if(data.type==="error")window.UI.toast(data.message||"Unable to send message.",{title:"Live Chat",type:"error"});
    if(data.type==="closed"){$("#liveChatState").textContent="Conversation closed";liveStarted=false}
  }catch{}};
  ws.onopen=()=>{clearTimeout(chatReconnectTimer);if(mode==='live'){updateAvailability();void loadOffers($('#liveChatMessages'));}};
  ws.onclose=()=>{
    if(chatSocket===ws)chatSocket=null;
    if(chatStarted&&liveStarted&&panelIsOpen()){
      clearTimeout(chatReconnectTimer);
      chatReconnectTimer=setTimeout(()=>{if(liveStarted)connectChat()},2500);
    }
  };
}
async function submitLive(){
  const input=$("#liveChatInput"),body=input?.value.trim();if(!body)return false;
  // Commands and handoff must remain usable while WebSocket reconnects.
  if(body.toLowerCase()==='/getaichat'){
    input.value='';await shareBotHandoff();return true;
  }
  if(body.toLowerCase()==='/ai'){
    input.value='';await displayAIHealth('live');return true;
  }
  const command=parseQuickCommand(body,'visitor');
  if(command&&command.name!='/getaichat'){
    input.value='';
    if(command.name==='/payments'){void loadOffers($('#liveChatMessages'),true);window.UI.toast('Refreshing your project proposals and verified payment progress.',{title:'Project payments'});return true}
    if(command.name==='/createproject'){openVisitorCreateProject();return true}
    if(command.name==='/projects'){void openVisitorProjects();return true}
    if(command.name==='/clear'){
      if(await confirmChatClear()){const box=$('#liveChatMessages');if(box){box.replaceChildren();void loadOffers(box)}}
      return true;
    }
    if(command.name==='/help'){openCommandHelp(input,'visitor');return true}
    if(['/skills','/contact'].includes(command.name)){executeUiCommand({type:'navigate',target:command.name.slice(1)},{closeChat});return true}
  }
  if(!chatSocket||chatSocket.readyState!==WebSocket.OPEN){window.UI.toast("Chat is reconnecting; your message was not sent. Please retry.",{title:"Live Chat",type:"error"});return false}
  chatSocket.send(JSON.stringify({body}));input.value="";return true;
}
function newMessage(sender,body){return {id:`bot_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,sender,body,createdAt:Date.now()}}
function description(line){return String(line??"").replace(/\s+/g," ").trim().slice(0,170)}
function matchingProjects(data,query){
  const words=query.toLowerCase().split(/[^a-z0-9]+/).filter(w=>w.length>=3);
  const projects=(data.projects||[]).filter(p=>p.visible!==false);
  return projects.map(p=>({p,weight:words.filter(word=>`${p.name||""} ${p.description||""} ${(p.stack||[]).join(" ")}`.toLowerCase().includes(word)).length}))
    .sort((a,b)=>b.weight-a.weight).filter(x=>x.weight>0).slice(0,4).map(x=>x.p);
}
const botAnswer = (body,projectKeys=[],extras={}) => ({body,projectKeys,...extras});
async function checkTonex(){
  try{const state=await window.APIManager.getTonexStatus();aiConfigured=!!state.enabled;aiOnline=!!state.online;}
  catch{aiOnline=false}
  updateAvailability();
}
async function askOnline(prompt, history){
  // The AI inference gateway has a smaller prompt budget than rich chat / code.
  if(!aiConfigured || prompt.length>1800)return null;
  try{
    const response=await window.APIManager.askTonex({message:prompt,history,purpose:"chat"});
    aiOnline=!!response.online;updateAvailability();document.dispatchEvent(new CustomEvent("portfolio:ai-response"));
    // Trusted UI enhancements are selected from the user's intent and already
    // published site records, never raw model-provided JavaScript or URLs.
    const q=prompt.toLowerCase(),published=window.PublicStore?.current||{};
    const intro=/introduc|who (are|is)|tell me about|about you|yourself/.test(q);
    const profiles=published.profiles?.items||published.information?.profile_images||[];
    const actions=/\b(contact|email|phone|hire|collaborat)\b/.test(q)
      ?[{type:'navigate',target:'contact',label:'Contact'},{type:'live',label:'Live Chat'}]
      :explicitBrowseIntent(q)&&/\bprojects?\b/.test(q)
      ?[{type:'navigate',target:'projects',label:'View projects'}]
      :explicitBrowseIntent(q)&&/\b(certificates?|credentials?)\b/.test(q)
      ?[{type:'navigate',target:'certificates',label:'View certificates'}]
      :explicitBrowseIntent(q)&&/\b(career|resume|documents?|curriculum)\b/.test(q)
      ?[{type:'navigate',target:'career',label:'Career documents'}]
      :[];
    const allowCards=explicitBrowseIntent(q);
    return botAnswer(response.reply||'',allowCards?(response.project_keys||[]):[],{
      certificateIds:allowCards?(response.certificate_ids||[]):[],documentIds:allowCards?(response.document_ids||[]):[],actions,
      profileImage:intro?selectIntroPortrait(profiles):null,introCard:intro
    });
  }catch{aiOnline=false;updateAvailability();return null}
}
// Handoff persists through HTTP rather than requiring a connected WebSocket.
// /getaichat is explicit visitor consent to share only the recent Bot exchange.
async function shareBotHandoff(){
  const messages=guestHistory.slice(-18).filter(m=>m.sender==='visitor'||m.sender==='bot').map(m=>({role:m.sender==='visitor'?'user':'assistant',content:String(m.body||'').slice(0,600)}));
  if(!messages.length){window.UI.toast('Ask Tonex a question first, then use /getaichat to share the discussion.',{title:'Chat handoff',type:'warning'});return false}
  try{
    await window.APIManager.openChatSession();
    await window.APIManager.handoffTonex({confirmed:true,messages});
    window.UI.toast('Your recent Tonex conversation was shared with Admin. You can continue in Live Chat.',{title:'Chat handoff'});
    setMode('live');await ensureLive();return true;
  }catch(err){window.UI.toast((err.status===403?'Live Chat is unavailable. Sign in first to leave a message while Admin is away.':err.message),{title:'Chat handoff',type:'error'});return false}
}
async function displayAIHealth(target='bot'){
  try{
    const value=await window.APIManager.getTonexStatus();
    const line=value.online?'**AI assistant:** Responding recently.':'**AI assistant:** No recent verified AI response; local guidance is available.';
    const text=`**Tonex Bot · Service health**\n\n${line}\n\n**Conversation:** ${botBusy?'Processing a request':'Ready'}\n\n**Live Chat:** ${status.transport_online===false?'Unavailable':'Connection status may vary'}.`;
    if(target==='bot')addBotMessage(newMessage('bot',text));else addLiveMessage(newMessage('admin',text));
  }catch{window.UI.toast('Assistant health could not be checked right now.',{title:'Tonex health',type:'warning'})}
}

function wantsSocial(q){return /\b(social|facebook|linkedin|github|twitter|\bx\b|social media|social links|social accounts)\b/i.test(q)}
function publishedSocials(data){
  const links=data.information?.contact?.links||{};
  const names={github:'GitHub',linkedin:'LinkedIn',facebook:'Facebook',x:'X (Twitter)'};
  return Object.entries(names).filter(([k])=>{try{const u=new URL(String(links[k]||''));return u.protocol==='https:'&&!!u.hostname}catch{return false}}).map(([k,label])=>`- [${label}](${links[k]})`).join('\n');
}
function explicitBrowseIntent(q){return /(?:show|list|browse|view|see|explore|open|tell me about)\s+(?:me\s+)?(?:your\s+|some\s+)?(?:projects?|certificates?|credentials?|experience|career|portfolio)/i.test(q)||/what (have you|did you) built/i.test(q)}
function localCommand(prompt){
 const conversation=guestHistory.slice(-5).map(x=>String(x.body||'')).join(' ');
 const {command,remainder}=parseUiRequest(prompt,conversation);
 if(!command)return null;
 const done=executeUiCommand(command,{closeChat});
 if(!done)return null;
 const actual=command.type==='theme'?document.documentElement.dataset.theme:'';
 const text=command.type==='theme'?`The portfolio theme is now **${actual}**.`:`Taking you to the **${command.target}** section.`;
 return {message:botAnswer(text,[],{actions:[]}),remainder};
}

export function skillSections(skills){
  if(Array.isArray(skills))return skills.slice(0,35).map(s=>typeof s==="string"?`- ${s}`:`- ${s.name||s.title||"Skill"}`).join("\n");
  if(!skills||typeof skills!=="object")return "No published skills are listed yet.";
  const labels={frontend:"Frontend",backend:"Backend",database:"Databases",hosting:"Hosting & infrastructure",desktop:"Desktop",mobile:"Mobile",console:"Languages",iot:"IoT / Embedded"};
  const sections=[];
  for(const [group,value] of Object.entries(skills)){
    if(Array.isArray(value))sections.push(`**${group==="soft"?"Soft skills":group}**\n${value.slice(0,12).join(", ")}`);
    else if(value&&typeof value==="object"){
      const list=Object.entries(value).filter(([,arr])=>Array.isArray(arr)&&arr.length).map(([k,arr])=>`- **${labels[k]||k}:** ${arr.slice(0,13).join(", ")}`);
      if(list.length)sections.push(`**${group==="it"?"Technical skills":group}**\n${list.join("\n")}`);
    }
  }
  return sections.join("\n\n")||"No published skills are listed yet.";
}
async function answerBot(prompt){
  let data;
  try{
    // Refresh from the published API when online; on outage, the existing
    // validated bundled Supabase/static snapshot remains the fallback.
    if(window.ServerStatus?.ready===true&&(!answerBot.lastRefresh||Date.now()-answerBot.lastRefresh>30000)){
      try{await window.PublicStore.refresh()}catch{}
      answerBot.lastRefresh=Date.now();
    }
    data=await window.PublicStore.init();
  }catch{data={projects:[],certificates:[],career_profiles:[],information:{}}}
  const q=prompt.toLowerCase(),name=data.information?.name?.full||"Jhon Anthony Pano";
  if(pricingRequest(q))return botAnswer(pricingDiscovery(prompt,guestHistory));
  if(/\b(what|which)\s+(?:ai\s+)?model|\bwhat llm|\bwhich llm|\bprovider.*running|\byour model/i.test(q))return botAnswer("I'm **Tonex Bot**, the JPano Portfolio assistant. What would you like help with?");
  if(wantsSocial(q)){
    const links=publishedSocials(data);
    return botAnswer(links?`Here are the developer's published social profiles:\n\n${links}`:'No public social profiles are currently available. You can use the [Contact form](#contact).');
  }
  if(/resume|curriculum|biodata|cv\b|career|download/.test(q)){
    const docs=(data.career_profiles||[]).slice(0,6);
    return botAnswer(docs.length?`${variation("career")}

## Published documents\n${docs.map(d=>`- **${d.title||docLabel(d.document_type)}** — ${description(d.description)||docLabel(d.document_type)}`).join("\n")}\n\nOpen **Career Profile** on this page to preview or download.`:"There are no published Career Profile documents yet. You can ask for one using the **Contact** section.",[],{documentIds:docs.map(d=>d.id)});
  }
  if(/(?:programming|coding|development) languages?|languages? (?:for|good|best|to learn)/.test(q)&& !/\b(your|jpano|developer's)\b/.test(q)){
    return botAnswer('Useful languages depend on the project: **JavaScript/TypeScript** for interactive web apps, **Python** for automation and data, **Go** for efficient APIs, **Java/C#** for enterprise systems, **Kotlin/Swift** for native mobile apps, and **SQL** for databases. Tell me what you are building and I can suggest a focused stack.');
  }
  if(/skill|technology|stack|framework|language|tool|iot|frontend|backend/.test(q)){
    return botAnswer(`${variation("skills")}

## Published technical skills\n${skillSections(data.information?.skills)}\n\n[View the Skills section](#skills)`,[],{actions:[{type:"navigate",target:"skills",label:"See skills"}]});
  }
  if(/experience|previous work|work history|job|restaurant|catering|waiter|freelanc/.test(q)){
    const exp=data.information?.experience||{},jobs=[exp.current,...(exp.previous||[])].filter(Boolean);
    const facts=jobs.map(j=>`- **${j.position||'Professional experience'}**${j.company_name?` at ${j.company_name}`:''}${j.start_date?` (${j.start_date}${j.end_date?`–${j.end_date}`:''})`:''}${(j.responsibilities||[]).length?` — ${description(j.responsibilities[0])}`:''}`).slice(0,6);
    return botAnswer(`${variation("experience")}

## Published experience\n${facts.length?facts.join('\n'):'No public work history has been added yet.'}\n\nUnlisted client work is not disclosed without permission.`,[],{actions:[{type:'navigate',target:'experience',label:'View experience'}]});
  }
  if(/contact|email|phone|hire|collaborat|work together/.test(q)){
    const c=data.information?.contact||{};
    const email=String(c.email||'');
    const phone=(c.mobile||[]).find(Boolean)||'';
    const socials=publishedSocials(data);
    return botAnswer(`${variation("contact")}

You can contact **${name}** through these published details:\n\n${email?`- **Email:** [${email}](mailto:${email})\n`:''}${phone?`- **Phone:** ${phone}\n`:''}${socials?`\n**Social profiles**\n${socials}\n`:''}\n[Open the Contact form](#contact)`,[],{actions:[{type:'navigate',target:'contact',label:'Contact form'},{type:'live',label:'Talk to human'}]});
  }
  if(/certificate|credential|award/.test(q))return botAnswer(`${variation("certificates")}

## Certificates\nThere are **${(data.certificates||[]).length}** publicly listed certificates.\n\n[Browse certificates](#certificates)`,[],{certificateIds:(data.certificates||[]).slice(0,4).map(c=>c.id),actions:[{type:"navigate",target:"certificates",label:"All certificates"}]});
  if(/\b(projects?|portfolio projects|built|electri)\b/.test(q) && explicitBrowseIntent(q)){
    const matches=matchingProjects(data,q),projects=matches.length?matches:(data.projects||[]).filter(p=>p.visible!==false).slice(0,4);
    return botAnswer(`${variation("projects")}

## Published projects\n${projects.map(p=>`- **${p.name}** — ${description(p.description)||p.type||"Published project"}`).join("\n")||"Published projects are temporarily unavailable."}\n\n[Browse all projects](#projects)`,projects.map(p=>p.key));
  }
  const intro=/introduc|who (are|is)|tell me about|about you|yourself/.test(q);
  const profile=data.profiles?.items||data.information?.profile_images||[];
  return botAnswer(intro?introductionFromPublished(data.information,`${variation("intro")} I'm **Tonex Bot**, the website's portfolio guide.`):`${variation("general")}

I'm **Tonex Bot**. Ask me a question about the developer or the site, and I'll answer directly.`,[],{actions:intro?[{type:'navigate',target:'contact',label:'Contact'}]:[],profileImage:intro?selectIntroPortrait(profile):null,introCard:intro});
}
async function initBot(){
  if(botReady)return;botReady=true;
  try{guestHistory=await loadBotHistory()}catch{guestHistory=[]}
  guestHistory.forEach(addBotMessage);
  if(!guestHistory.length){const welcome={...newMessage("bot",`${variation("welcome")}

I'm **Tonex Bot**. What would you like to know or do today?`),actions:[]};addBotMessage(welcome)}
}
async function submitBot(){
  const input=$("#botChatInput"),body=input?.value.trim();if(!body||botBusy)return;
  if(body.toLowerCase()==='/ai'){input.value='';await displayAIHealth('bot');return}
  if(body.toLowerCase()==='/getaichat'){input.value='';await shareBotHandoff();return}
  const command=parseQuickCommand(body,'bot');
  if(command){
    input.value='';
    if(command.name==='/clear'){
      if(await confirmChatClear()){try{await clearBotHistory()}catch{}guestHistory=[];$('#botChatMessages').replaceChildren();botReady=false;await initBot()}
      return;
    }
    if(command.name==='/help'){openCommandHelp(input,'bot');return}
    if(command.name==='/theme'){
      const desired=command.arg.toLowerCase()||'toggle';
      if(!['light','dark','toggle'].includes(desired)){
        addBotMessage(newMessage('bot','Use `/theme dark`, `/theme light`, or `/theme toggle`.'));return;
      }
      const done=executeUiCommand({type:'theme',value:desired});
      addBotMessage(newMessage('bot',done?`Theme changed to **${document.documentElement.dataset.theme}**.`:'I could not change the theme. Use the theme switch in the page header.'));
      return;
    }
    if(['/projects','/skills','/contact','/about'].includes(command.name)){executeUiCommand({type:'navigate',target:command.name.slice(1)},{closeChat});return}
  }
  const history=guestHistory.slice(-12).map(m=>({role:m.sender==="visitor"?"user":"assistant",content:String(m.body||'').slice(0,1200)}));
  const message=newMessage("visitor",body);input.value="";addBotMessage(message);
  botBusy=true;
  const send=$("#botChatForm button[type=submit]");if(send)send.disabled=true;
  const progress=document.createElement('div');progress.className='tonex-processing';progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');
  progress.innerHTML='<span class="tonex-processing-dot" aria-hidden="true"></span><span>Tonex is responding…</span>';
  const messages=$('#botChatMessages');messages?.append(progress);if(messages)messages.scrollTop=messages.scrollHeight;
  let answer;
  try{
    const actionResult=localCommand(body);
    const followUp=actionResult?.remainder||'';
    if(actionResult){
      answer=actionResult.message;
      // A compound request is not discarded just because a local UI action succeeded.
      if(followUp){
        const more=(await askOnline(followUp,history))||(await answerBot(followUp));
        if(more?.body){const {body:_ignored,...extras}=more;answer=botAnswer(`${answer.body}\n\n${more.body}`,more.projectKeys||[],extras)}
      }
    }
    if(!answer && pricingRequest(body)){
      // When a real feature list was already supplied, let the assistant work
      // through it instead of always returning the same discovery question.
      if(pricingScope(body,history).hasScope){
        answer=await askOnline(body,history);
        if(!answer)answer=botAnswer(pricingDiscovery(body,history));
      }else answer=botAnswer(pricingDiscovery(body,history));
    }
    if(!answer && wantsSocial(body))answer=await answerBot(body);
    if(!answer)answer=await askOnline(body,history);
    if(!answer)answer=await answerBot(body);
  }catch{answer=botAnswer('Tonex could not complete that request. Please try again.');}
  const reply={...newMessage("bot",answer.body),projectKeys:answer.projectKeys||[],certificateIds:answer.certificateIds||[],documentIds:answer.documentIds||[],profileImage:answer.profileImage||null,introCard:answer.introCard===true,actions:answer.actions||[]};
  addBotMessage(reply);
  guestHistory.push(message,reply);guestHistory=guestHistory.slice(-80);
  try{await Promise.all([saveBotMessage(message),saveBotMessage(reply)])}catch{window.UI.toast("Local chat storage is unavailable; messages will last only while this page is open.",{title:"Guest history",type:"error"})}
  finally{botBusy=false;if(send)send.disabled=false;progress.remove()}
}
export function initLiveChat(){
  if(chatStarted)return;chatStarted=true;
  void window.PublicStore.init().then(data=>{ownerName=data?.information?.name?.full||ownerName}).catch(()=>{});
  // Reparent the panel to document.body so transformed ancestor layouts and
  // mobile browsers cannot constrain a position:fixed full-screen overlay.
  const panel=document.getElementById("liveChatPanel");if(panel&&panel.parentElement!==document.body)document.body.append(panel);
  wireChatCopy(panel);
  initCustomControls($("#liveChatWidget"),{selects:false});
  $("#liveChatLauncher")?.addEventListener("click",()=>{panelIsOpen()?closeChat():(revealChat(),initBot(),setMode(mode),$("#botChatInput")?.focus())});
  $("#liveChatClose")?.addEventListener("click",closeChat);
  document.querySelectorAll("[data-chat-mode]").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.chatMode)));
  $("#liveChatForm")?.addEventListener("submit",e=>{e.preventDefault();void submitLive()});
  $("#botChatForm")?.addEventListener("submit",e=>{e.preventDefault();void submitBot()});
  bindTextAttachment($("#botChatInput"),$("#botChatFile"),$("#botChatAttach"));
  bindTextAttachment($("#liveChatInput"),$("#liveChatFile"),$("#liveChatAttach"));
  bindChatDrop($("#botChatInput"),$("#botChatForm"));
  bindChatDrop($("#liveChatInput"),$("#liveChatForm"));
  bindSlashCommands($("#botChatInput"),'bot');
  bindSlashCommands($("#liveChatInput"),'visitor');
  for(const [selector,formId] of [["#liveChatInput","#liveChatForm"],["#botChatInput","#botChatForm"]]){
    bindChatComposer($(selector));
    $(selector)?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$(formId)?.requestSubmit()}});
  }
  $("#chatVerifyAccount")?.addEventListener("click",()=>document.dispatchEvent(new CustomEvent("portfolio:request-shared-identity",{detail:{source:"chat"}})));
  $("#clearBotHistory")?.addEventListener("click",async()=>{
    if(!await confirmChatClear())return;
    try{await clearBotHistory()}catch{window.UI.toast("Couldn't clear saved history.",{title:"Chat",type:"error"})}
    guestHistory=[];$("#botChatMessages").innerHTML="";botReady=false;await initBot();
  });
  void checkStatus();void checkTonex();statusTimer=setInterval(()=>{void checkStatus();void checkTonex()},15000);
  document.addEventListener("portfolio:server-status",checkStatus);
  document.addEventListener("portfolio:feedback-identity",()=>{void checkStatus()});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&liveStarted){void loadOffers($('#liveChatMessages'));if(!chatSocket||chatSocket.readyState===WebSocket.CLOSED)connectChat()}});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&panelIsOpen()&&$("#feedbackAuthModal")?.hidden)closeChat()});
  updateAvailability();
  let reopen=false;
  try{reopen=sessionStorage.getItem("jpano-chat-auth-intent")==="reopen";if(reopen)sessionStorage.removeItem("jpano-chat-auth-intent")}catch{}
  let returned=false;
  try{
    const url=new URL(location.href);
    returned=url.searchParams.get('checkout_return')==='1';
    if(returned){url.searchParams.delete('checkout_return');history.replaceState(null,'',url.pathname+url.search+url.hash)}
  }catch{}
  if(reopen||returned)setTimeout(()=>{revealChat();void initBot();setMode("live");if(returned)window.UI.toast('Checkout returned. Waiting for PayMongo to confirm your payment automatically.',{title:'Payment status',type:'warning',timeout:8500})},600);
}
export function cleanupCareerChat(){chatStarted=false;clearInterval(statusTimer);clearTimeout(closeTimer);clearTimeout(chatReconnectTimer);chatSocket?.close();chatSocket=null}
