/* Only these user-initiated, reversible UI commands are executable.
   The AI may suggest text, but cannot provide JavaScript or arbitrary actions. */
const targets = Object.freeze({projects:'projects',project:'projects',skills:'skills',skill:'skills',certificates:'certificates',certificate:'certificates',experience:'experience',education:'education',contact:'contact',career:'career',documents:'career',about:'about'});
export function understandUiCommand(text,previousContext=''){
  const input=String(text||'').trim().toLowerCase();
  const context=String(previousContext||'').toLowerCase();
  const action=/(?:\b(change|switch|toggle|set|make|turn|use|try|enable|activate|apply)\b|\b(can|could|would) you\b)/.test(input);
  const explicitTheme=/\b(theme|dark mode|light mode|appearance|color scheme|colour scheme)\b/.test(input);
  const previousTheme=/\b(theme|dark mode|light mode|appearance|color scheme|colour scheme)\b/.test(context);
  const contextualTheme=/\b(dark|light|opposite|different|other)\b/.test(input) &&
    (/\b(it|this|that|the page|the site|website|portfolio|mode|background)\b/.test(input)||previousTheme);
  // A follow-up like "yes, change it to dark" is an explicit visitor command
  // when the preceding conversation discussed the site's appearance.
  if(action && (explicitTheme || (previousTheme && contextualTheme) ||
      /\b(?:page|site|website|portfolio)\b.+\b(?:dark|light)\b/.test(input))){
    const target=input.match(/\b(dark|light)\b/);
    const opposite=/\b(opposite|different|other|not (?:my |the )?current|toggle)\b/.test(input);
    return {type:'theme',value:opposite?'toggle':target?target[1]:'toggle'};
  }
  const nav=input.match(/^(?:please\s+)?(?:go|jump|scroll|navigate|show|take me|open|bring me)(?:\s+(?:to(?: the)?|me|the))?\s+(projects?|skills?|certificates?|experience|education|contact|career|documents?|about)(?:\s+section)?[.!?]?$/);
  if(nav)return {type:'navigate',target:targets[nav[1].replace(/s$/,'')]||targets[nav[1]]};
  return null;
}
// A combined request can switch the theme AND ask another question. Keep the
// additional text for the AI rather than silently dropping it after the action.
export function parseUiRequest(text,previousContext=''){
  const raw=String(text||'').trim();
  const parts=raw.split(/\s*(?:[.!?]\s*)?(?:also,?|by the way,?|btw,?|and also)\s*/i);
  const command=understandUiCommand(parts[0]||raw,previousContext);
  if(!command)return {command:null,remainder:raw};
  return {command,remainder:parts.length>1?parts.slice(1).join(' ').trim().replace(/^,\s*/,''):''};
}
export function executeUiCommand(action,{closeChat}={}){
  if(!action||typeof action!=='object')return false;
  if(action.type==='theme' && ['dark','light','toggle'].includes(action.value)){
    const theme=window.UI?.Theme;
    if(!theme?.apply||!theme?.current)return false;
    const target=action.value==='toggle'?(theme.current()==='dark'?'light':'dark'):action.value;
    theme.apply(target,true);
    return document.documentElement.dataset.theme===target;
  }
  if(action.type==='navigate' && Object.values(targets).includes(action.target)){
    const target=action.target;
    if(target==='career'){
      closeChat?.();document.getElementById('careerProfileButton')?.click();return true;
    }
    const element=document.getElementById(target);
    if(!element)return false;
    closeChat?.();element.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
    try{history.replaceState(null,'',`#${target}`)}catch{}
    return true;
  }
  if(action.type==='live'){
    document.querySelector('[data-chat-mode="live"]')?.click();return true;
  }
  return false;
}
export const commonActions=Object.freeze([
  {type:'navigate',target:'projects',label:'See projects'},
  {type:'navigate',target:'experience',label:'Work experience'},
  {type:'navigate',target:'certificates',label:'Certificates'},
  {type:'navigate',target:'contact',label:'Contact'},
  {type:'live',label:'Live Chat'}
]);
