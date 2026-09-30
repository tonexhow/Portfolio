import { ICONS, compactMoney, escapeHTML, formatMoney, isVisibleValue, phoneHref, secureRandomIndex, ORIGINAL_TITLE } from "./helpers.js";

const { $, $$ } = window.UI;
let selectedGreetingMessage = "";
let lastAwayMessage = "";

function chooseGreetingMessage(data) {
  const messages = (data.greeting?.messages || []).filter(isVisibleValue);
  if (!messages.length) return "is here, ready to build your next idea.";
  return messages[secureRandomIndex(messages.length)];
}

export function renderGreeting(data, chooseNew = false) {
  const hour = new Date().getHours();
  const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  $("#greetingKicker").textContent = `${data.greeting?.[period] || "Hello"},`;
  if (chooseNew || !selectedGreetingMessage) selectedGreetingMessage = chooseGreetingMessage(data);
  const full = data.name?.full || "Jhon Anthony Pano";
  $("#greetingMessage").textContent = selectedGreetingMessage
    .replaceAll("{first}", data.name?.first || "Jhon Anthony")
    .replaceAll("{name}", full);
}

function renderName(data) {
  const target = $("#heroName");
  if (!target) return;
  const template = document.createElement("template");
  template.innerHTML = data.name?.highlighted_html || escapeHTML(data.name?.full || "Jhon Anthony Pano");
  // Only text and the original span highlight are accepted from the editor.
  function safeName(node) {
    if (node.nodeType === Node.TEXT_NODE) return escapeHTML(node.textContent);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const inner = [...node.childNodes].map(safeName).join("");
    return node.tagName === "SPAN" ? `<span class="name-accent">${inner}</span>` : inner;
  }
  target.innerHTML = [...template.content.childNodes].map(safeName).join("");
  target.setAttribute("aria-label", data.name?.full || "Jhon Anthony Pano");
}

function buildAbout(data) {
  const root = $("#aboutParagraphs");
  const capstones = Number(data.portfolio?.capstone_count || 0);
  const projectCount = Number(data.portfolio?.projects?.count || 0);
  const earnings = data.portfolio?.earnings || {};
  const range = `${formatMoney(earnings.min, earnings.currency)} to ${formatMoney(earnings.max, earnings.currency)}`;
  const templates = (data.portfolio?.about_templates || []).filter(isVisibleValue);
  const text = templates.map(template => escapeHTML(template)
    .replaceAll("{capstone_count}", `<strong class="inline-emphasis">${capstones}</strong>`)
    .replaceAll("{project_count}", `<strong class="inline-emphasis">${projectCount}</strong>`)
    .replaceAll("{project_range}", `<strong class="inline-emphasis">${escapeHTML(range)}</strong>`)
  ).join(" ");
  root.innerHTML = text ? `<p>${text}</p>` : "";
}

function renderExperience(experience) {
  const root = $("#experienceTimeline");
  const items = [experience.current, ...(experience.previous || [])].filter(Boolean);
  root.innerHTML = items.map((item, index) => {
    const company = isVisibleValue(item.company_name) ? `<h4>${escapeHTML(item.company_name)}</h4>` : "";
    const responsibilities = (item.responsibilities || []).filter(isVisibleValue).slice(0, 2);
    const when = [item.start_date, item.end_date]
      .filter(isVisibleValue)
      .map(value => String(value).toLowerCase() === "current" ? "Present" : value)
      .join(" to ");
    return `<article class="timeline-item">
      <div class="timeline-top"><h3>${escapeHTML(item.position || "")}</h3>${when ? `<time>${escapeHTML(when)}</time>` : ""}</div>
      ${company}
      ${responsibilities.map(text => `<p>${escapeHTML(text)}</p>`).join("")}
    </article>`;
  }).join("");
}

function renderEducation(education) {
  const root = $("#educationGrid");
  const order = ["tertiary", "senior_high_school", "junior_high_school", "elementary"];
  const labels = { tertiary: "College", senior_high_school: "Senior High", junior_high_school: "Junior High", elementary: "Elementary" };
  const items = order.map(key => [key, education[key]]).filter(([, item]) => item && isVisibleValue(item.school_name));
  root.innerHTML = items.map(([key, item], index) => {
    const program = item.course || item.strand || "";
    const current = String(item.year_graduated || "").toLowerCase() === "current";
    const year = current ? "Present" : item.year_graduated;
    return `<article class="education-item ${current ? "education-current" : ""}">
      <div class="education-year">${current ? `<span class="current-tag"><i></i>Current</span>` : escapeHTML(year || "Year not listed")}</div>
      <div class="education-content">
        <span class="education-level">${labels[key]}</span>
        <h3>${escapeHTML(item.school_name)}</h3>
        ${isVisibleValue(program) ? `<p class="education-program">${escapeHTML(program)}</p>` : ""}
        ${isVisibleValue(item.school_address) ? `<small>${escapeHTML(item.school_address)}</small>` : ""}
      </div>
    </article>`;
  }).join("");
}

function renderSkills(skills) {
  const technicalRoot = $("#technicalSkillBoard");
  const softRoot = $("#softSkillBoard");
  const technicalGroups = Object.entries(skills.it || {}).filter(([, values]) => Array.isArray(values) && values.some(isVisibleValue));
  technicalRoot.innerHTML = technicalGroups.map(([name, values], index) => {
    const clean = values.filter(isVisibleValue);
    return `<article class="skill-group skill-tone-${index % 4}">
      <div class="skill-group-head"><div><span class="skill-overline">Technical</span><h3>${escapeHTML(name.replaceAll("_", " "))}</h3></div><small>${clean.length}</small></div>
      <div class="skill-items">${clean.map(value => `<span>${escapeHTML(value)}</span>`).join("")}</div>
    </article>`;
  }).join("");

  const soft = (skills.soft || []).filter(isVisibleValue);
  const areaCount = $("#skillAreaCount");
  const softCount = $("#softSkillCount");
  if (areaCount) areaCount.textContent = String(technicalGroups.length);
  if (softCount) softCount.textContent = String(soft.length);
  softRoot.innerHTML = `<div class="soft-skill-head"><span class="skill-overline">Working style</span><h3>Soft skills</h3><p>People and work habits I rely on when coordinating, solving problems, and finishing practical project work.</p></div>
    <div class="soft-skill-list">${soft.map(value => `<span>${escapeHTML(value)}</span>`).join("")}</div>`;
}

function renderTechBelt(skills) {
  const preferred = [
    ...(skills.it?.frontend || []),
    ...(skills.it?.backend || []),
    ...(skills.it?.database || []),
    ...(skills.it?.iot || [])
  ].filter(isVisibleValue);
  const unique = [...new Set(preferred)].slice(0, 18);
  const group = unique.map(value => `<span>${escapeHTML(value)}</span><i></i>`).join("");
  $("#techBeltTrack").innerHTML = `<div class="tech-belt-group">${group}</div><div class="tech-belt-group" aria-hidden="true">${group}</div>`;
}

function renderFooter(contact) {
  const root = $("#footerLinks");
  const links = contact.links || {};
  const items = [];
  if (isVisibleValue(links.github)) items.push({ key: "github", label: "GitHub", href: links.github, external: true });
  if (isVisibleValue(links.linkedin)) items.push({ key: "linkedin", label: "LinkedIn", href: links.linkedin, external: true });
  if (isVisibleValue(links.facebook)) items.push({ key: "facebook", label: "Facebook", href: links.facebook, external: true });
  if (isVisibleValue(links.x)) items.push({ key: "x", label: "X", href: links.x, external: true });
  if (isVisibleValue(contact.email)) items.push({ key: "email", label: "Email", href: `mailto:${contact.email}` });
  const phone = (contact.mobile || []).find(isVisibleValue);
  if (phone) items.push({ key: "phone", label: "Phone", href: phoneHref(phone) });

  root.innerHTML = items.filter(item=>!item.external||window.PublicStore.safeURL(item.href)).map(item => `<a class="footer-link" href="${escapeHTML(item.href)}" ${item.external ? 'target="_blank" rel="noopener noreferrer"' : ""} aria-label="${escapeHTML(item.label)}" title="${escapeHTML(item.label)}">${ICONS[item.key] || ""}</a>`).join("");
  $("#footerYear").textContent = String(new Date().getFullYear());
}

export function renderPersonalInformation(data) {
  renderName(data);
  if(!document.hidden)document.title=`${data.name?.full||"Portfolio"} · Portfolio`;
  const portrait=$("#profileImage");if(portrait)portrait.alt=`Portrait of ${data.name?.full||"portfolio owner"}`;
  renderGreeting(data, true);

  const role = data.role || "Full Stack Developer";
  const rawIntro = data.intro || "I create web experiences, backend services, databases, and connected systems with an emphasis on clear interfaces, dependable logic, and practical results.";
  const intro = rawIntro.replace(/^I\s+/i, "I ");
  const introTail = intro.replace(/^I\s+/i, "");
  $("#heroIntro").innerHTML = `<span>As a <strong>${escapeHTML(role)}</strong>, I ${escapeHTML(introTail)}</span>`;
  $("#heroLocation").textContent = (data.location || "").replace(", Philippines", "");

  const email = data.contact?.email || "";
  const emailLink = $("#contactEmail");
  if (emailLink) {
    emailLink.href = email ? `mailto:${email}` : "#";
    emailLink.hidden = !isVisibleValue(email);
  }
  const phone = (data.contact?.mobile || []).find(isVisibleValue) || "";
  const phoneLink = $("#contactPhone");
  if (phoneLink) {
    phoneLink.href = phone ? phoneHref(phone) : "#";
    phoneLink.hidden = !isVisibleValue(phone);
  }

  const capstones = Number(data.portfolio?.capstone_count || 0);
  const projectCount = Number(data.portfolio?.projects?.count || 0);
  $("#capstoneCount").textContent = String(capstones);
  $("#heroCapstoneCount").textContent = String(capstones);
  $("#heroProjectCount").textContent = String(projectCount);
  $("#aboutProjectCount").textContent = String(projectCount);

  const earnings = data.portfolio?.earnings || {};
  const range = `${formatMoney(earnings.min, earnings.currency)} – ${formatMoney(earnings.max, earnings.currency)}`;
  $("#heroEarning").textContent = range;
  $("#earningRange").textContent = `${compactMoney(earnings.min, earnings.currency)}–${compactMoney(earnings.max, earnings.currency)}`;

  $("#projectsIntro").textContent = data.portfolio?.projects?.intro || "";
  $("#projectVisibilityNote").textContent = data.portfolio?.projects?.visibility_note || "";

  buildAbout(data);
  renderExperience(data.experience || {});
  renderEducation(data.education || {});
  renderSkills(data.skills || {});
  renderTechBelt(data.skills || {});
  renderFooter(data.contact || {});
}

export function wireTabMessages(getPersonal) {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = `${getPersonal()?.name?.full||"Portfolio"} · Portfolio`;
      return;
    }
    const personal = getPersonal();
    const messages = (personal?.portfolio?.tab_messages || []).filter(isVisibleValue);
    if (!messages.length) {
      document.title = "Your next idea can start here";
      return;
    }
    const pool = messages.filter(message => message !== lastAwayMessage);
    const choices = pool.length ? pool : messages;
    lastAwayMessage = choices[secureRandomIndex(choices.length)];
    document.title = lastAwayMessage;
  });
}
