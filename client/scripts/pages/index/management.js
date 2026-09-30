const manageLink = document.querySelector("#manageLink");
const markerKey="jpano-management-known-until";

export async function initManagementAccess() {
  if (!manageLink) return;
  const knownUntil=Number(localStorage.getItem(markerKey)||0);
  if(!knownUntil||knownUntil<=Date.now()){
    localStorage.removeItem(markerKey);
    manageLink.hidden=true;
    return;
  }
  try {
    const session = await window.APIManager.getAccessSession();
    manageLink.hidden = !session.authorized;
    if(session.authorized&&session.expires_at){
      localStorage.setItem(markerKey,String(new Date(session.expires_at).getTime()));
    }else{
      localStorage.removeItem(markerKey);
    }
  } catch {
    manageLink.hidden = true;
  }
}