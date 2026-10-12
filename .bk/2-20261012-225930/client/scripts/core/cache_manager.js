(() => {
  "use strict";
  const prefix="jpano-cache:";
  const now=()=>Date.now();

  function key(name){return prefix+name}
  function get(name){
    try{
      const raw=localStorage.getItem(key(name));
      if(!raw)return null;
      const item=JSON.parse(raw);
      if(!item||typeof item!=="object"||!item.expires_at||item.expires_at<=now()){
        localStorage.removeItem(key(name));return null;
      }
      return item.value;
    }catch{return null}
  }
  function set(name,value,ttlMs){
    try{localStorage.setItem(key(name),JSON.stringify({value,expires_at:now()+ttlMs}))}catch{}
    return value;
  }
  async function getOrFetch(name,ttlMs,loader){
    const cached=get(name);
    if(cached!==null)return cached;
    const value=await loader();
    return set(name,value,ttlMs);
  }
  function clear(name){try{localStorage.removeItem(key(name))}catch{}}
  function clearPrefix(namePrefix){
    try{
      const full=key(namePrefix);
      for(let i=localStorage.length-1;i>=0;i--){
        const k=localStorage.key(i);
        if(k&&k.startsWith(full))localStorage.removeItem(k);
      }
    }catch{}
  }
  async function registerServiceWorker(){
    if (!("serviceWorker" in navigator)) return;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || "";
        if (script.startsWith(location.origin + "/service-worker.js")) await registration.unregister();
      }
    } catch {}
  }
  function shouldRecordVisit(){
    const name="visit-window";
    const cached=get(name);
    if(cached)return false;
    set(name,true,30*60*1000);
    return true;
  }
  window.CacheManager=Object.freeze({get,set,getOrFetch,clear,clearPrefix,registerServiceWorker,shouldRecordVisit});
})();