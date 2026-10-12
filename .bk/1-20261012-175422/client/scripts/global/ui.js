(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const Theme = {
    key: "jpano-theme", modes: ["light", "dark"],
    saved() { try { const v=localStorage.getItem(this.key); return this.modes.includes(v) ? v : ""; } catch { return ""; } },
    system() { return matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light"; },
    current() { return this.saved() || this.system(); },
    apply(mode, persist = true) {
      const safe = mode === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = safe;
      if (persist) { try { localStorage.setItem(this.key, safe); } catch {} }
      $$('[data-theme-option]').forEach(button => { const active = button.dataset.themeOption === safe; button.classList.toggle("active", active); button.setAttribute("aria-pressed", String(active)); });
      $$('[data-theme-toggle]').forEach(button => { button.dataset.theme = safe; button.setAttribute("aria-label", safe === "dark" ? "Switch to light theme" : "Switch to dark theme"); button.title = safe === "dark" ? "Light theme" : "Dark theme"; });
      const meta = $('meta[name="theme-color"]'); if (meta) meta.content = safe === "dark" ? "#090d12" : "#f6f8fb";
    },
    toggle() { this.apply(this.current() === "dark" ? "light" : "dark", true); },
    init() {
      this.apply(this.current(), false);
      $$('[data-theme-option]').forEach(button => { if (button.dataset.themeBound) return; button.dataset.themeBound = "1"; button.addEventListener("click", () => this.apply(button.dataset.themeOption, true)); });
      $$('[data-theme-toggle]').forEach(button => { if (button.dataset.themeBound) return; button.dataset.themeBound = "1"; button.addEventListener("click", () => this.toggle()); });
      if (!this.bound) {
        this.bound = true;
        addEventListener("storage", event => { if (event.key === this.key) this.apply(this.current(), false); });
        matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", () => { if (!this.saved()) this.apply(this.system(), false); });
      }
    }
  };

  function toast(message, { title = "Done", type = "success", timeout = 4200 } = {}) {
    const region = $("#toastRegion");
    if (!region) return;
    const item = document.createElement("div");
    item.className = `toast ${type}`;
    item.innerHTML = `<i class="toast-dot"></i><div><strong></strong><span></span></div><button type="button" aria-label="Dismiss">×</button>`;
    $("strong", item).textContent = title;
    $("span", item).textContent = message;
    const remove = () => item.remove();
    $("button", item).addEventListener("click", remove);
    region.append(item);
    if (timeout) setTimeout(remove, timeout);
  }

  function setButtonLoading(button, loading, label = "Working…") {
    if (!button) return;
    if (loading) {
      if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
      button.disabled = true;
      button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${label}</span>`;
    } else {
      button.disabled = false;
      queueMicrotask(() => window.ServerStatus?.paint());
      if (button.dataset.originalHtml) button.innerHTML = button.dataset.originalHtml;
    }
  }


  const PageLoader = {
    element: null,
    ensure() {
      if (this.element?.isConnected) return this.element;
      const el=document.createElement("div");
      el.className="app-loader";
      el.id="appLoader";
      el.setAttribute("role","status");
      el.setAttribute("aria-live","polite");
      el.innerHTML=`<div class="app-loader-card">
        <button class="loader-play" type="button" aria-label="Play with loading animation">
          <span class="loader-ring ring-a"></span><span class="loader-ring ring-b"></span>
          <span class="loader-core"><b>J</b><b>P</b></span>
        </button>
        <strong>Loading JPano.dev</strong>
        <span class="loader-message">Preparing the workspace</span>
        <progress class="loader-progress" max="100" value="0" aria-label="Portfolio loading progress"></progress>
        <small class="loader-progress-copy">0% ready</small>
      </div>`;
      document.body.append(el);
      el.querySelector(".loader-play")?.addEventListener("click",()=>{
        el.classList.toggle("playful");
        const message=el.querySelector(".loader-message");
        if(message)message.textContent=el.classList.contains("playful")?"Nice. One more spin.":"Preparing the workspace";
      });
      this.element=el;
      return el;
    },
    show() {
      const el=this.ensure();
      requestAnimationFrame(()=>el.classList.add("show"));
    },
    setMessage(message) {
      const el=this.element||this.ensure();
      const node=el.querySelector(".loader-message");
      if(node&&message)node.textContent=message;
    },
    setProgress(value) {
      const el=this.element||this.ensure();
      const progress=el.querySelector(".loader-progress");
      const copy=el.querySelector(".loader-progress-copy");
      const safe=Math.max(0,Math.min(100,Math.round(Number(value)||0)));
      if(progress)progress.value=safe;
      if(copy)copy.textContent=`${safe}% ready`;
    },
    hide() {
      const el=this.element||document.getElementById("appLoader");
      if(!el)return Promise.resolve();
      el.classList.remove("show");
      el.classList.add("leaving");
      return new Promise(resolve=>setTimeout(()=>{el.remove();this.element=null;resolve()},320));
    }
  };

  function initReveal() {
    const nodes = $$(".reveal:not(.visible)");
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      nodes.forEach(node => node.classList.add("visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    }), { threshold: .05, rootMargin: "0px 0px -10px" });
    nodes.forEach(node => observer.observe(node));
  }

  function initNavigation() {
    const toggle = $("#menuToggle");
    const closeButton = $("#drawerClose");
    const drawer = $("#siteNav");
    const backdrop = $("#navBackdrop");
    const header = $("#siteHeader");
    const navLinks = $$(".desktop-nav a, .drawer-links a");
    const sectionIds = [...new Set(navLinks.map(link => link.getAttribute("href")?.slice(1)).filter(Boolean))];
    const sections = sectionIds.map(id => $(`#${id}`)).filter(Boolean);
    let navigationTarget = "";
    let navigationTimer = null;
    let ticking = false;

    const markerFor = section => section?.querySelector(".section-heading, .contact-intro") || section;
    const markerTop = section => {
      const marker = markerFor(section);
      return marker ? marker.getBoundingClientRect().top + scrollY : Number.POSITIVE_INFINITY;
    };
    const landingOffset = () => (header?.offsetHeight || 0) + 7;

    const setActive = id => {
      navLinks.forEach(link => link.classList.toggle("active", Boolean(id) && link.getAttribute("href") === `#${id}`));
    };

    const close = () => {
      drawer?.classList.remove("open");
      backdrop?.classList.remove("open");
      toggle?.setAttribute("aria-expanded", "false");
      drawer?.setAttribute("aria-hidden", "true");
      document.body.classList.remove("menu-open");
    };

    const open = () => {
      drawer?.classList.add("open");
      backdrop?.classList.add("open");
      toggle?.setAttribute("aria-expanded", "true");
      drawer?.setAttribute("aria-hidden", "false");
      document.body.classList.add("menu-open");
    };

    toggle?.addEventListener("click", () => drawer?.classList.contains("open") ? close() : open());
    closeButton?.addEventListener("click", close);
    backdrop?.addEventListener("click", close);
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    $$(".drawer-links a, .drawer-foot a").forEach(link => link.addEventListener("click", close));

    const update = () => {
      ticking = false;
      header?.classList.toggle("scrolled", scrollY > 8);

      const doc = document.documentElement;
      const max = doc.scrollHeight - innerHeight;
      const progress = max > 0 ? (scrollY / max) * 100 : 0;
      const bar = $("#scrollProgress");
      if (bar) bar.value = Math.min(100, Math.max(0, progress));

      if (navigationTarget) {
        setActive(navigationTarget);
        const section = $(`#${navigationTarget}`);
        if (section) {
          const desired = markerTop(section) - landingOffset();
          if (Math.abs(scrollY - Math.max(0, desired)) <= 10) {
            navigationTarget = "";
            clearTimeout(navigationTimer);
          }
        }
        if (navigationTarget) return;
      }

      const probe = scrollY + landingOffset() + 14;
      let active = "";
      for (const section of sections) {
        if (markerTop(section) <= probe) active = section.id;
        else break;
      }
      if (scrollY + innerHeight >= doc.scrollHeight - 3 && sections.length) active = sections.at(-1).id;
      setActive(active);
    };

    const schedule = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(update);
    };

    $$('a[href^="#"]').filter(link => link.getAttribute("href").length > 1).forEach(link => {
      link.addEventListener("click", event => {
        const id = link.getAttribute("href").slice(1);
        const target = $(`#${id}`);
        if (!target) return;
        event.preventDefault();
        close();

        requestAnimationFrame(() => {
          const landing = id === "home" ? target : markerFor(target);
          const top = landing.getBoundingClientRect().top + scrollY - landingOffset();
          if (id !== "home") {
            navigationTarget = id;
            setActive(id);
            clearTimeout(navigationTimer);
            navigationTimer = setTimeout(() => {
              navigationTarget = "";
              schedule();
            }, 1250);
          } else {
            navigationTarget = "";
            setActive("");
          }

          scrollTo({
            top: Math.max(0, top),
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
          });
          history.replaceState(null, "", `#${id}`);
        });
      });
    });

    update();
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule, { passive: true });
    addEventListener("hashchange", schedule);
  }


  const FOOTER_ICONS = {
    github:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3.3-.4 6.8-1.6 6.8-7A5.4 5.4 0 0 0 19.4 4 5 5 0 0 0 19.3.5S18.1.1 15 1.8a13.4 13.4 0 0 0-7 0C4.9.1 3.7.5 3.7.5A5 5 0 0 0 3.6 4a5.4 5.4 0 0 0-1.4 3.7c0 5.3 3.5 6.5 6.8 6.9A4.8 4.8 0 0 0 8 18v4"/><path d="M8 19c-3 .9-3-1.5-4-2"/></svg>',
    linkedin:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="4" height="12"/><circle cx="5" cy="5" r="2"/><path d="M11 21V9h4v2c1-1.6 2.5-2.4 4-2 2 .4 2 2.2 2 5v7h-4v-6c0-1.5-.5-2.5-1.8-2.5S15 13.6 15 15v6z"/></svg>',
    facebook:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8h4V4h-4c-3 0-5 2-5 5v3H6v4h3v6h4v-6h4l1-4h-5V9c0-.7.3-1 1-1z"/></svg>',
    x:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4l16 16M20 4 4 20"/></svg>',
    email:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
    phone:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c1 .3 1.9.6 2.9.7a2 2 0 0 1 1.7 2z"/></svg>'
  };

  function footerPhoneHref(value){return `tel:${String(value||"").replace(/[^+\d]/g,"")}`}
  function footerVisible(value){const text=String(value??"").trim();return text!==""&&!/^(n\/?a|none|null|undefined|-)$/i.test(text)}

  function renderSharedFooterLinks(contact={}){
    const links=contact.links||{};
    const items=[];
    if(footerVisible(links.github))items.push({key:"github",label:"GitHub",href:links.github,external:true});
    if(footerVisible(links.linkedin))items.push({key:"linkedin",label:"LinkedIn",href:links.linkedin,external:true});
    if(footerVisible(links.facebook))items.push({key:"facebook",label:"Facebook",href:links.facebook,external:true});
    if(footerVisible(links.x))items.push({key:"x",label:"X",href:links.x,external:true});
    if(footerVisible(contact.email))items.push({key:"email",label:"Email",href:`mailto:${contact.email}`});
    const phone=(contact.mobile||[]).find(footerVisible);
    if(phone)items.push({key:"phone",label:"Phone",href:footerPhoneHref(phone)});

    $$('[data-footer-links]').forEach(root=>{
      root.replaceChildren();
      items.forEach(item=>{
        const link=document.createElement("a");
        link.className="footer-link";
        if(item.external&&!window.PublicStore.safeURL(item.href))return;
        link.href=item.external?window.PublicStore.safeURL(item.href):item.href;
        link.setAttribute("aria-label",item.label);
        link.title=item.label;
        if(item.external){link.target="_blank";link.rel="noopener noreferrer"}
        link.innerHTML=FOOTER_ICONS[item.key]||"";
        root.append(link);
      });
    });
  }

  function mountSharedFooters(){
    const roots=$$('[data-shared-footer]');
    const markup=`<div class="shell footer-layout">
      <div class="footer-left">
        <a class="footer-brand" href="/#home" data-footer-top aria-label="JPano home">
          <span class="brand-mark" aria-hidden="true"><img src="/assets/icons/logo-light.svg" alt="" class="brand-icon logo-light"><img src="/assets/icons/logo-dark.svg" alt="" class="brand-icon logo-dark"></span>
          <strong>JPano<span class="brand-dev">.dev</span></strong>
        </a>
        <p>Building practical digital systems with clear interfaces and dependable logic.</p>
      </div>
      <div class="footer-center">
        <p>© <span id="footerYear" data-footer-year></span> <span data-personal-name>Jhon Anthony Pano</span></p>
        <nav class="footer-links" id="footerLinks" data-footer-links aria-label="Social and contact links"></nav>
      </div>
      <div class="footer-right">
        <p>Have an idea worth building?</p>
        <a href="/#home" data-footer-top>Back to top <span aria-hidden="true">↑</span></a>
      </div>
    </div>`;
    roots.forEach(root=>root.innerHTML=markup);
    $$('[data-footer-year]').forEach(node=>node.textContent=String(new Date().getFullYear()));
    $$('[data-footer-top]').forEach(link=>link.addEventListener("click",event=>{
      if(location.pathname!=="/"&&location.pathname!=="/index.html")return;
      event.preventDefault();
      scrollTo({top:0,behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
      history.replaceState(null,"","#home");
    }));
    const syncFooter = async () => {
      const data = await window.APIManager.getPersonalInformation();
      renderSharedFooterLinks(data.contact || {});
      $$('[data-personal-role]').forEach(node=>{node.textContent=data.role||"Full Stack Developer";});
      $$('[data-personal-name]').forEach(node => { node.textContent = data.name?.full || "Jhon Anthony Pano"; });
    };
    void syncFooter();
    document.addEventListener("portfolio:content-updated", () => void syncFooter());
  }

  mountSharedFooters();

  window.UI = Object.freeze({ $, $$, Theme, toast, setButtonLoading, PageLoader, initReveal, initNavigation });
  Theme.init();
  if(document.body?.dataset.loaderMode!=="manual"){
    addEventListener("load",()=>setTimeout(()=>PageLoader.hide(),260),{once:true});
    setTimeout(()=>PageLoader.hide(),6500);
  }
})();