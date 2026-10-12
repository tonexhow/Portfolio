// Build-only helper: prefer live published Supabase records, but map old
// PostgreSQL-blob image routes to known build-time fallback files by record ID.
// It never resurrects a deleted record: membership comes solely from the live RPC.
const legacyMedia = value => typeof value === 'string' && /^\/api\/public\/(?:certificates\/\d+\/(?:image|download)|project-media\/[^/]+)(?:\?.*)?$/.test(value);
const existingStatic = value => typeof value === 'string' && /^\/assets\/published\/[A-Za-z0-9._-]+$/.test(value);
export function mergePublishedMedia(live,old) {
  if(!live || live.schema_version !== 1 || !Array.isArray(live.projects) || !Array.isArray(live.certificates) ||
     !Array.isArray(live.feedback) || !live.information || typeof live.information !== 'object' ||
     live.projects.some(p=>p.visible !== true) || live.feedback.some(f=>f.status === 'pending')){
    throw new Error('Unsafe or incomplete published snapshot');
  }
  const previousCerts = new Map((old?.certificates||[]).map(c=>[String(c.id),c]));
  const previousProjects = new Map((old?.projects||[]).map(p=>[String(p.key),p]));
  const warnings=[];
  for(const certificate of live.certificates){
    const oldCert=previousCerts.get(String(certificate.id));
    if(legacyMedia(certificate.image_url)){
      if(existingStatic(oldCert?.image_url))certificate.image_url=oldCert.image_url;
      else warnings.push(`Certificate ${certificate.id} needs Supabase Storage for offline display.`);
    }
    if(legacyMedia(certificate.download_url) && existingStatic(certificate.image_url))certificate.download_url=certificate.image_url;
  }
  for(const project of live.projects){
    const oldProject=previousProjects.get(String(project.key));
    if(legacyMedia(project.icon)&&existingStatic(oldProject?.icon))project.icon=oldProject.icon;
    if(Array.isArray(project.images))project.images=project.images.map((image,i)=>legacyMedia(image)&&existingStatic(oldProject?.images?.[i])?oldProject.images[i]:image);
    project.status='unknown';project.checked_at=null;
  }
  return {snapshot:live,warnings};
}
