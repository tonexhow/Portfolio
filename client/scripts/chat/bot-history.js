// Local-only guest Bot history. No account tokens or server synchronization.
const DB_NAME="jpano-guest-bot", STORE="messages", MAX_ITEMS=80;
let connection;
function openDB(){
  if(!("indexedDB" in window))return Promise.reject(new Error("IndexedDB is unavailable"));
  if(connection)return connection;
  connection=new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  return connection;
}
export async function loadBotHistory(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const req=db.transaction(STORE,"readonly").objectStore(STORE).getAll();
    req.onsuccess=()=>resolve((req.result||[]).sort((a,b)=>a.createdAt-b.createdAt).slice(-MAX_ITEMS));
    req.onerror=()=>reject(req.error);
  });
}
export async function saveBotMessage(message){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(message);
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}
export async function clearBotHistory(){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).clear();
    tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);
  });
}
