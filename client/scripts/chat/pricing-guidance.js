/* Context-sensitive discovery: assess the visitor's actual scope instead of
   refusing every cost question. Never turn vague ideas into a binding quote. */
export function pricingRequest(text){
  if(/\bhow much (?:time|long|hours|days)\b/i.test(String(text||'')))return false;
  return /\b(?:how much(?: would| does| will| for| to)?|price|pricing|cost(?:ing|s)?|budget|quot(?:e|ation)|estimate|rate for|ballpark)\b/i.test(String(text||''));
}
const features=/\b(?:homepage|landing page|projects? section|skill[s]? section|resume|cv|contact form|blog|testimonial|login|sign.?up|authentication|users?|roles?|admin|dashboard|analytics|payments?|checkout|notifications?|inventory|booking|appointments?|reports?|tracking|uploads?|integrations?|api|website|web app|mobile app|database|e.?commerce|commerce|store|pages?|modules?|frontend|backend|cms|search|chat|portfolio)\b/gi;
export function pricingScope(message,history=[]){
  const user=[...history.filter(x=>x && (x.role==='user'||x.sender==='visitor')).slice(-8).map(x=>String(x.content||x.body||'')),String(message||'')];
  const full=user.join('\n').slice(-9000);
  const matches=[...new Set((full.match(features)||[]).map(x=>x.toLowerCase()))];
  const lines=user.join('\n').split(/\n/).map(x=>x.replace(/^[-*\d.)\s]+/,'').trim()).filter(x=>x.length>=12);
  const detailedList=lines.filter(x=>/[:：]|\b(?:allow|include|display|show|manage|provide|support|create|user|section|form|dashboard|page)\b/i.test(x));
  const hasScope=(matches.length>=3 && (detailedList.length>=2 || full.length>210)) || (matches.length>=5);
  return {hasScope,matchedFeatures:matches.slice(0,14),details:detailedList.slice(-9)};
}
export function pricingDiscovery(message,history=[]){
  const scope=pricingScope(message,history);
  if(scope.hasScope){
    const listed=scope.details.slice(-7).map(x=>`- ${x.slice(0,150)}`).join('\n');
    if(/\b(table|worklist|work list|breakdown|deliverables)\b/i.test(String(message||''))){
      const items=(scope.details.length?scope.details.slice(-7):scope.matchedFeatures).map(x=>String(x).replace(/\|/g,'/').slice(0,135));
      const table=items.map((item,i)=>`| ${i+1} | ${item} | Scope and acceptance criteria to confirm |`).join('\n');
      return `Thanks, you've already provided a starting feature list. Here's a **draft worklist** for review:\n\n| # | Requested work | Next step |\n|---:|---|---|\n${table}\n\n**Also plan for:** UI design, security, testing, deployment, documentation and support. These are provisional items, not an approved quote. Cost depends on complexity, integrations, revisions and deadlines, with no arbitrary project price ceiling. Admin can price the confirmed worklist. What budget and deadline should we plan around?`;
    }
    return `Thanks, you've already outlined useful requirements. Here is the **working scope** I can use for a quote discussion:\n\n${listed||scope.matchedFeatures.map(x=>`- ${x}`).join('\n')}\n\nPricing depends on design depth, integrations, timeline, revisions, hosting and support—not a fixed portfolio price cap. What budget and deadline do you have in mind? Admin can confirm a tailored quotation once those are agreed.`;
  }
  return 'I can help estimate this, but I need to know **what you want built** first. Could you list the main features or screens, who will use them, and whether this is web, mobile or desktop? If you have a budget or deadline, include it. Then I can prepare a feature-by-feature worklist and an indicative pricing discussion—not an invented fixed quote.';
}
