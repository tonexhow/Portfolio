import {initShell} from "./shell.js";
import {loadOverview} from "./overview.js";
import {initDashboard,loadDashboard} from "./dashboard.js";
import {initFeedbacks,loadFeedbacks} from "./feedbacks.js";
import {initContacts,loadContacts} from "./contacts.js";
import {initCertificates,loadCertificates} from "./certificates.js";
import {initProjects,loadProjects} from "./projects.js";
import {initInformation,loadInformation} from "./information.js";
import {initCareer,loadCareer} from "./career.js";
import {initChats,loadChats} from "./chats.js?v=44";

initDashboard();
initFeedbacks();
initContacts();
initCertificates();
initProjects();
initInformation();
initCareer();
initChats();

const loaders={
  overview:loadOverview,
  dashboard:loadDashboard,
  feedbacks:()=>loadFeedbacks(true),
  contacts:()=>loadContacts(true),
  certificates:loadCertificates,
  projects:loadProjects,
  information:loadInformation,
  career:loadCareer,
  chats:loadChats
};
initShell((view,force=false)=>loaders[view]?.(force));
