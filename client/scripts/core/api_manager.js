(() => {
  "use strict";

  async function request(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    const hasBody = options.body !== undefined && options.body !== null;
    if (hasBody && !(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (!["GET", "HEAD"].includes(method)) headers.set("X-Portfolio-Request", "1");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || window.APP_CONFIG?.requestTimeoutMs || 7000);
    try {
      const response = await fetch(window.PublicStore.apiURL(path), { ...options, method, credentials: "include", headers, signal: options.signal || controller.signal });
      const type = response.headers.get("content-type") || "";
      if (!type.includes("application/json")) throw new Error("The API did not return a valid response.");
      const data = await response.json();
      if (!response.ok) {
        if (!path.startsWith("/api/public/ai/")) window.ServerStatus?.noteResponse?.(response.status);
        const error = new Error(data?.error || `Request failed (${response.status}).`);
        error.status=response.status;error.data=data;throw error;
      }
      if (path.startsWith("/api/") && !path.startsWith("/api/public/ai/")) window.ServerStatus?.noteDatabaseSuccess?.();
      return data;
    } catch (cause) {
      if (cause.status) throw cause;
      if (!path.startsWith("/api/public/ai/")) window.ServerStatus?.noteNetworkFailure?.();
      const error = new Error("The server could not be reached. Reconnect and refresh before retrying; a request already sent may have completed.");
      error.status=0;error.cause=cause;throw error;
    } finally { clearTimeout(timer); }
  }

  async function publishUpdate() {
    try { await window.PublicStore.refresh({ broadcast: true }); }
    catch { document.dispatchEvent(new CustomEvent("portfolio:sync-pending")); }
  }

  const clear=name=>window.CacheManager?.clearPrefix?.(name);

  window.APIManager = Object.freeze({
    request,
    apiURL: path => window.PublicStore.apiURL(path),
    mediaURL: path => window.PublicStore.mediaURL(path),
    getPersonalInformation: async () => (await window.PublicStore.init()).information,
    getProfiles: async () => (await window.PublicStore.init()).profiles,
    getProjects: (page = 1, limit = 9) => window.PublicStore.page("projects", page, limit),
    getFeedback: (page = 1, limit = 5) => window.PublicStore.page("feedback", page, limit),
    getCertificates: (page = 1, limit = 6) => window.PublicStore.page("certificates", page, limit),
    getFeedbackAuthProviders: () => request("/api/public/feedback-auth/providers", { cache: "no-store" }),
    getFeedbackAuthSession: () => request("/api/public/feedback-auth/session", { cache: "no-store" }),
    getContactAuthSession: () => request("/api/public/contact-auth/session", { cache: "no-store" }),
    clearFeedbackAuthSession: () => request("/api/public/feedback-auth/logout", { method: "POST", body: "{}" }),
    submitFeedback: async payload => {
      const result=await request("/api/public/feedback", { method: "POST", body: JSON.stringify(payload) });
      clear("feedback:");
      await publishUpdate();
      return result;
    },
    submitContact: payload => request("/api/public/contact", { method: "POST", body: JSON.stringify(payload) }),
    recordVisit: () => request("/api/public/visit", { method: "POST", body: "{}" }),
    getCareerProfiles: async () => (await window.PublicStore.init()).career_profiles || [],
    getChatStatus: () => request("/api/public/chat/status", { cache: "no-store" }),
    getTonexStatus: () => request("/api/public/ai/status", { cache: "no-store",timeout:4000 }),
    askTonex: payload => request("/api/public/ai/chat", { method:"POST",body:JSON.stringify(payload),cache:"no-store",timeout:35000 }),
    openChatSession: () => request("/api/public/chat/session", { method: "POST", body: "{}", cache: "no-store" }),
    handoffTonex: payload => request('/api/public/chat/handoff',{method:'POST',body:JSON.stringify(payload),cache:'no-store',timeout:12000}),
    getChatOffers: () => request("/api/public/chat/offers", { cache:"no-store" }),
    getChatInquiries: () => request('/api/public/chat/inquiries',{cache:'no-store'}),
    createChatInquiry: payload => request('/api/public/chat/inquiries',{method:'POST',body:JSON.stringify(payload)}),
    withdrawChatInquiry: id => request(`/api/public/chat/inquiries/${encodeURIComponent(id)}/withdraw`,{method:'POST',body:'{}'}),
    getAdminChatInquiries: id => request(`/api/admin/chats/${encodeURIComponent(id)}/inquiries`,{cache:'no-store'}),
    updateAdminInquiry: (id,payload) => request(`/api/admin/inquiries/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
    archiveProjectOffer: id => request(`/api/admin/project-offers/${encodeURIComponent(id)}/archive`,{method:'POST',body:'{}'}),
    createProjectOffer: (thread,payload) => request(`/api/admin/chats/${encodeURIComponent(thread)}/offers`, {method:"POST",body:JSON.stringify(payload)}),
    verifyOfferPayment: id => request(`/api/public/chat/offers/${encodeURIComponent(id)}/verify`,{method:"POST",body:"{}",timeout:18000}),
    verifyAdminTransaction: id => request(`/api/admin/transactions/${encodeURIComponent(id)}/verify`,{method:"POST",body:"{}",timeout:18000}),
    createOfferCheckout: (id,amount_centavos,email="",phone="") => request(`/api/public/chat/offers/${encodeURIComponent(id)}/checkout`, {method:"POST",body:JSON.stringify({amount_centavos,email,phone}),timeout:18000}),
    getAdminChatOffers: id => request(`/api/admin/chats/${encodeURIComponent(id)}/offers`,{cache:"no-store"}),
    getAdminTransactions: (page=1,status="",visibility="active") => request(`/api/admin/transactions?page=${encodeURIComponent(page)}&status=${encodeURIComponent(status)}&archived=${encodeURIComponent(visibility)}`,{cache:"no-store"}),
    archiveAdminTransaction: id => request(`/api/admin/transactions/${encodeURIComponent(id)}/archive`,{method:'POST',body:'{}'}),
    clearPaidAdminTransactions: () => request('/api/admin/transactions/clear-paid',{method:'POST',body:'{}'}),
    getDatabaseTables: () => request('/api/admin/database/tables',{cache:'no-store'}),
    getDatabaseRows: (schema,table,page=1) => request(`/api/admin/database/tables/${encodeURIComponent(schema)}/${encodeURIComponent(table)}/rows?page=${encodeURIComponent(page)}`,{cache:'no-store'}),
    uploadAdminChatImage: (thread,file) => {
      const form=new FormData();form.append('thread_id',thread);form.append('file',file);
      return request('/api/admin/chat/images',{method:'POST',body:form,timeout:40000});
    },
    getServerInfo: () => request('/api/admin/server/info',{cache:'no-store'}),
    checkServerNetwork: () => request('/api/admin/server/network-check',{method:'POST',body:'{}',cache:'no-store',timeout:23000}),
    getServerLogs: () => request('/api/admin/server/logs',{cache:'no-store'}),
    getAIProviders: () => request('/api/admin/ai/providers',{cache:'no-store'}),
    testAIHealth: () => request('/api/admin/ai/health',{method:'POST',body:'{}',cache:'no-store',timeout:65000}),
    createAIProvider: payload => request('/api/admin/ai/providers',{method:'POST',body:JSON.stringify(payload)}),
    updateAIProvider: (id,payload) => request(`/api/admin/ai/providers/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(payload)}),
    deleteAIProvider: id => request(`/api/admin/ai/providers/${encodeURIComponent(id)}`,{method:'DELETE'}),
    revealAIProvider: id => request(`/api/admin/ai/providers/${encodeURIComponent(id)}/reveal`,{method:'POST',body:'{}',cache:'no-store'}),
    getAIReplyDrafts: () => request('/api/admin/ai/reply-drafts',{cache:'no-store'}),
    sendAIReplyDraft: (id,payload) => request(`/api/admin/ai/reply-drafts/${encodeURIComponent(id)}/send`,{method:'POST',body:JSON.stringify(payload),timeout:20000}),
    chatWebSocketURL: path => { const u=new URL(window.PublicStore.apiURL(path)); u.protocol=u.protocol==="https:"?"wss:":"ws:"; return u.href; },

    getAccessSession: () => request("/api/access/session", { cache: "no-store" }),
    getPendingAccess: () => request("/api/access/pending", { cache: "no-store" }),
    createAccessChallenge: () => request("/api/access/challenge", { method: "POST", body: "{}" }),
    requestManagementAccess: payload => request("/api/access/request", { method: "POST", body: JSON.stringify(payload) }),
    verifyAccessOTP: payload => request("/api/access/otp", { method: "POST", body: JSON.stringify(payload) }),
    grantManagementAccess: token => request("/api/access/grant", { method: "POST", body: JSON.stringify({ token }) }),
    finalizeManagementAccess: requestId => request("/api/access/finalize", { method: "POST", body: JSON.stringify({ request_id: requestId }) }),
    logoutManagement: async () => {
      const result=await request("/api/access/logout", { method: "POST", body: "{}" });
      localStorage.removeItem("jpano-management-known-until");
      return result;
    },
    openAccessEvents: requestId => new EventSource(window.PublicStore.apiURL(`/api/access/events?request_id=${encodeURIComponent(requestId)}`), { withCredentials: true }),

    getAdminOverview: () => request("/api/admin/overview", { cache: "no-store" }),
    getAdminAnalytics: () => request("/api/admin/analytics", { cache: "no-store" }),
    getAdminFeedback: ({ page = 1, status = "", q = "" } = {}) => request(`/api/admin/feedback?page=${encodeURIComponent(page)}&limit=20&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`, { cache: "no-store" }),
    updateAdminFeedback: async (id, payload) => {
      const body=typeof payload==="string"?{status:payload}:payload;
      const result=await request(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) });
      clear("feedback:");
      await publishUpdate();
      return result;
    },
    deleteAdminFeedback: async id => {
      const result=await request(`/api/admin/feedback/${encodeURIComponent(id)}`, { method: "DELETE" });
      clear("feedback:");
      await publishUpdate();
      return result;
    },
    getAdminContacts: ({ page = 1, status = "", q = "" } = {}) => request(`/api/admin/contacts?page=${encodeURIComponent(page)}&limit=20&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`, { cache: "no-store" }),
    updateAdminContact: (id, status) => request(`/api/admin/contacts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) }),
    deleteAdminContact: id => request(`/api/admin/contacts/${encodeURIComponent(id)}`, { method: "DELETE" }),
    replyAdminContact: (id, payload) => request(`/api/admin/contacts/${encodeURIComponent(id)}/reply`, { method: "POST", body: JSON.stringify(payload) }),
    getAdminCertificates: ({ page = 1, status = "", q = "" } = {}) => request(`/api/admin/certificates?page=${encodeURIComponent(page)}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`, { cache: "no-store" }),
    addAdminCertificate: async formData => {
      const result=await request("/api/admin/certificates", { method: "POST", body: formData });
      clear("certificates:");
      await publishUpdate();
      return result;
    },
    updateAdminCertificate: async (id, formData) => {
      const result=await request(`/api/admin/certificates/${encodeURIComponent(id)}`, { method: "POST", body: formData });
      clear("certificates:");
      await publishUpdate();
      return result;
    },
    setAdminCertificateState: async (id, payload) => {
      const result=await request(`/api/admin/certificates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) });
      clear("certificates:");
      await publishUpdate();
      return result;
    },
    deleteAdminCertificate: async id => {
      const result=await request(`/api/admin/certificates/${encodeURIComponent(id)}`, { method: "DELETE" });
      clear("certificates:");
      await publishUpdate();
      return result;
    },
    getAdminProjects: ({ page = 1, source = "all", q = "" } = {}) => request(`/api/admin/projects?page=${encodeURIComponent(page)}&limit=20&source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`, { cache: "no-store" }),
    addAdminProject: async payload => {
      const result=await request("/api/admin/projects", { method: "POST", body: JSON.stringify(payload) });
      clear("projects:");
      await publishUpdate();
      return result;
    },
    updateAdminProject: async (key, payload) => {
      const result=await request(`/api/admin/projects/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(payload) });
      clear("projects:");
      await publishUpdate();
      return result;
    },
    reorderAdminProjects: async (keys,start) => {
      const result=await request("/api/admin/projects/reorder", { method: "POST", body: JSON.stringify({keys,start}) });
      clear("projects:");
      await publishUpdate();
      return result;
    },
    deleteAdminProject: async key => {
      const result=await request(`/api/admin/projects/${encodeURIComponent(key)}`, { method: "DELETE" });
      clear("projects:");
      await publishUpdate();
      return result;
    },
    pingAdminProject: async key => {
      const result = await request(`/api/admin/projects/${encodeURIComponent(key)}/ping`, { method: "POST", body: "{}" });
      await publishUpdate(); return result;
    },
    uploadProjectImage: file => {
      const form = new FormData(); form.append("file", file);
      return request("/api/admin/project-media", { method: "POST", body: form, timeout: 30000 });
    },
    getAdminInformation: () => request("/api/admin/information", { cache: "no-store" }),
    createInformationChallenge: () => request("/api/admin/information/challenge", { method: "POST", body: "{}" }),
    getAdminCareerProfiles: () => request("/api/admin/career-profiles", { cache: "no-store" }),
    addAdminCareerProfile: form => request("/api/admin/career-profiles", { method: "POST", body: form, timeout: 30000 }),
    updateAdminCareerProfile: (id, form) => request(`/api/admin/career-profiles/${encodeURIComponent(id)}`, { method: "POST", body: form, timeout: 30000 }),
    deleteAdminCareerProfile: id => request(`/api/admin/career-profiles/${encodeURIComponent(id)}`, { method: "DELETE" }),
    getAdminChats: (page=1) => request(`/api/admin/chats?page=${encodeURIComponent(page)}`, { cache: "no-store" }),
    getAdminChatMessages: (id,before=null) => request(`/api/admin/chats/${encodeURIComponent(id)}${before?`?before=${encodeURIComponent(before)}`:""}`, { cache: "no-store" }),
    deleteAdminChat: id => request(`/api/admin/chats/${encodeURIComponent(id)}`, { method: "DELETE" }),
    saveAdminInformation: async payload => {
      const result=await request("/api/admin/information/save", { method: "POST", body: JSON.stringify(payload) });
      clear("personal");
      await publishUpdate();
      return result;
    }
  });
})();