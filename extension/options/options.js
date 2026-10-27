import { describeAccountResult, describeSessionStatus, ACCOUNT_STATUS } from "../sync/status.js";

const browser = globalThis.browser || globalThis.chrome;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text || "";
}

function getMsg(key, substitutions) {
  try {
    if (browser && browser.i18n && typeof browser.i18n.getMessage === "function") {
      const msg = browser.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
  } catch {}
  return "";
}

function t(key) {
  return getMsg(key);
}

function localize() {
  // Handle data-i18n attributes
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const msg = t(key);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => {
    const key = el.getAttribute("data-i18n-html");
    if (!key) return;
    let msg = t(key);
    if (msg) {
      msg = msg.replace(/\$CODE\$/g, "<code>").replace(/\$\/CODE\$/g, "</code>");
      el.innerHTML = msg;
    }
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    const msg = t(key);
    if (msg) el.setAttribute("title", msg);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    const msg = t(key);
    if (msg) el.setAttribute("placeholder", msg);
  });
  // Handle __MSG_...__ placeholders in text content
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    nodes.push(node);
  }
  for (const textNode of nodes) {
    const original = textNode.nodeValue;
    if (!original || !original.includes("__MSG_")) continue;
    let replaced = original.replace(/__MSG_([A-Za-z0-9_]+)__/g, (match, key) => {
      const msg = t(key);
      return msg || match;
    });
    if (replaced !== original) {
      textNode.nodeValue = replaced;
    }
  }
  // Handle attributes
  document.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (attr.value && attr.value.includes("__MSG_")) {
        let replaced = attr.value.replace(/__MSG_([A-Za-z0-9_]+)__/g, (match, key) => {
          const msg = t(key);
          return msg || match;
        });
        if (replaced !== attr.value) {
          el.setAttribute(attr.name, replaced);
        }
      }
    }
  });
  const title = t("options_title");
  if (title) document.title = title;
}

function setVisible(id, visible) {
  const el = byId(id);
  if (el) el.classList.toggle("hidden", !visible);
}

export async function send(message) {
  try {
    return await browser.runtime.sendMessage(message);
  } catch {
    return { error: true };
  }
}

let submitting = false;

export async function refreshCatalogStats() {
  const stats = await send({ type: "catalog-stats" });
  if (stats && typeof stats.watched === "number") {
    setText("stat-watched", String(stats.watched));
    setText("stat-never-skip", String(stats.neverSkip));
    return stats;
  }
  return null;
}

export async function exportCatalogBackup() {
  setText("catalog-feedback", t("catalog_exporting") || "Exporting catalog...");
  const res = await send({ type: "catalog-export" });
  if (!res || !Array.isArray(res.records)) {
    setText("catalog-feedback", t("catalog_export_error") || "Error exporting catalog.");
    return;
  }
  try {
    const jsonStr = JSON.stringify(res.records, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `noreplay-catalog-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    let msg = t("catalog_export_success") || "Backup exported successfully ($COUNT$ records).";
    msg = msg.replace("$COUNT$", String(res.records.length));
    setText("catalog-feedback", msg);
    setTimeout(() => setText("catalog-feedback", ""), 3500);
  } catch (err) {
    let msg = t("catalog_export_file_error") || "Error generating backup file: $ERROR$";
    msg = msg.replace("$ERROR$", err.message || "unknown");
    setText("catalog-feedback", msg);
  }
}

export async function handleCatalogImportFile(file) {
  if (!file) return;
  setText("catalog-feedback", t("catalog_import_reading") || "Reading file...");
  try {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) {
      setText("catalog-feedback", t("catalog_import_invalid_format") || "Invalid format.");
      return;
    }
    const res = await send({ type: "catalog-import", records });
    if (res && typeof res.imported === "number") {
      let msg = t("catalog_import_success") || "$IMPORTED$ records imported successfully! (Total in catalog: $TOTAL$)";
      msg = msg.replace("$IMPORTED$", String(res.imported)).replace("$TOTAL$", String(res.total));
      setText("catalog-feedback", msg);
      await refreshCatalogStats();
      setTimeout(() => setText("catalog-feedback", ""), 4000);
    } else {
      setText("catalog-feedback", t("catalog_import_fail") || "Failed to import records.");
    }
  } catch (err) {
    let msg = t("catalog_import_processing_error") || "Error processing JSON file: $ERROR$";
    msg = msg.replace("$ERROR$", err.message || "unknown");
    setText("catalog-feedback", msg);
  }
}

export async function handleCatalogClear() {
  const confirmed = window.confirm(t("catalog_clear_confirm") || "Are you sure?");
  if (!confirmed) return;
  const res = await send({ type: "catalog-clear" });
  if (res && res.ok) {
    setText("catalog-feedback", t("catalog_cleared") || "Catalog cleared.");
    await refreshCatalogStats();
    setTimeout(() => setText("catalog-feedback", ""), 3500);
  } else {
    setText("catalog-feedback", t("catalog_clear_error") || "Error clearing catalog.");
  }
}

export async function loadServerUrl() {
  const res = await send({ type: "get-sync-config" });
  if (res && res.baseUrl) {
    const input = byId("server-url");
    if (input) input.value = res.baseUrl;
  }
}

export async function onSaveServerUrl(e) {
  e.preventDefault();
  const input = byId("server-url");
  const url = input ? input.value.trim() : "";
  setText("server-url-feedback", t("sync_server_url_saving") || "Saving URL...");
  const res = await send({ type: "set-server-url", baseUrl: url });
  if (res && res.ok) {
    setText("server-url-feedback", t("sync_server_url_saved") || "Server URL saved.");
    if (input) input.value = res.baseUrl;
    await refreshStatus();
    setTimeout(() => setText("server-url-feedback", ""), 2500);
  } else {
    setText("server-url-feedback", t("sync_server_url_error") || "Error saving URL.");
  }
}

export async function refreshStatus() {
  const res = await send({ type: "account-status" });
  if (!res || res.error) {
    setText("session-status", `${describeSessionStatus(ACCOUNT_STATUS.NETWORK_ERROR)} (${t("session_network_error") || "Network error (Local Offline mode active)"})`);
    setVisible("logout-form", false);
    setVisible("login-form", true);
    setVisible("signup-form", true);
    return;
  }
  if (res.sessionActive) {
    setText("session-status", `${describeSessionStatus(ACCOUNT_STATUS.SESSION_ACTIVE)} — ${t("session_active_syncing") || "Syncing with cloud"}`);
    setVisible("logout-form", true);
    setVisible("login-form", false);
    setVisible("signup-form", false);
  } else {
    const status = res.expired ? ACCOUNT_STATUS.SESSION_EXPIRED : ACCOUNT_STATUS.NO_SESSION;
    const baseText = describeSessionStatus(status);
    const suffix = res.expired ? "" : ` — ${t("session_no_session_offline") || "Not signed in — Local mode (Offline) active"}`;
    setText("session-status", `${baseText}${suffix}`);
    setVisible("logout-form", false);
    setVisible("login-form", true);
    setVisible("signup-form", true);
  }
}

async function runPhase(phase, message, formId, feedbackId) {
  if (submitting) return;
  submitting = true;
  setText(feedbackId, t("submitting") || "Submitting...");
  const res = await send(message);
  submitting = false;
  const described = describeAccountResult(res, { phase });
  setText(feedbackId, described.message);
  if (described.status === ACCOUNT_STATUS.SUCCESS) {
    const form = byId(formId);
    if (form) form.reset();
    await refreshStatus();
  }
}

function onSignup(e) {
  e.preventDefault();
  runPhase(
    "signup",
    {
      type: "account-signup",
      email: byId("signup-email").value.trim(),
      password: byId("signup-password").value,
    },
    "signup-form",
    "signup-feedback"
  );
}

function onLogin(e) {
  e.preventDefault();
  runPhase(
    "login",
    {
      type: "account-login",
      email: byId("login-email").value.trim(),
      password: byId("login-password").value,
    },
    "login-form",
    "login-feedback"
  );
}

function onLogout(e) {
  e.preventDefault();
  runPhase("logout", { type: "account-logout" }, "logout-form", "logout-feedback");
}

async function onHistoryImport(e) {
  e.preventDefault();
  if (submitting) return;
  submitting = true;
  const btn = byId("history-import-btn");
  if (btn) btn.disabled = true;
  const targetSelect = byId("history-target");
  const target = targetSelect ? targetSelect.value : "100";
  setText("history-import-feedback", t("history_import_opening") || "Opening history page...");
  const res = await send({ type: "start-history-import", targetCount: target });
  submitting = false;
  if (btn) btn.disabled = false;
  if (res && res.ok) {
    setText("history-import-feedback", t("history_import_opened") || "History opened in new tab. Track progress on YouTube.");
  } else {
    setText("history-import-feedback", t("history_import_error") || "Error starting history import.");
  }
}

export const HIDE_WATCHED_KEY = "settings.hideWatched";

export async function loadHideWatchedSetting(storage) {
  try {
    const stored = await storage.get(HIDE_WATCHED_KEY);
    if (!stored || stored[HIDE_WATCHED_KEY] === undefined) return true;
    return Boolean(stored[HIDE_WATCHED_KEY]);
  } catch {
    return true;
  }
}

export async function saveHideWatchedSetting(storage, value) {
  await storage.set({ [HIDE_WATCHED_KEY]: Boolean(value) });
}

function init() {
  localize();
  const signupForm = byId("signup-form");
  if (signupForm) signupForm.addEventListener("submit", onSignup);
  const loginForm = byId("login-form");
  if (loginForm) loginForm.addEventListener("submit", onLogin);
  const logoutForm = byId("logout-form");
  if (logoutForm) logoutForm.addEventListener("submit", onLogout);
  const historyForm = byId("history-import-form");
  if (historyForm) historyForm.addEventListener("submit", onHistoryImport);

  const serverConfigForm = byId("server-config-form");
  if (serverConfigForm) serverConfigForm.addEventListener("submit", onSaveServerUrl);

  const exportBtn = byId("catalog-export-btn");
  if (exportBtn) exportBtn.addEventListener("click", exportCatalogBackup);

  const importTriggerBtn = byId("catalog-import-trigger-btn");
  const importInput = byId("catalog-import-input");
  if (importTriggerBtn && importInput) {
    importTriggerBtn.addEventListener("click", () => importInput.click());
    importInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        handleCatalogImportFile(file);
        importInput.value = "";
      }
    });
  }

  const clearBtn = byId("catalog-clear-btn");
  if (clearBtn) clearBtn.addEventListener("click", handleCatalogClear);

  const hideWatchedInput = byId("setting-hide-watched");
  if (hideWatchedInput && browser && browser.storage && browser.storage.local) {
    let preferencesFeedbackTimer = null;
    loadHideWatchedSetting(browser.storage.local).then((enabled) => {
      hideWatchedInput.checked = enabled;
    });
    hideWatchedInput.addEventListener("change", async (e) => {
      await saveHideWatchedSetting(browser.storage.local, e.target.checked);
      setText("preferences-feedback", t("preferences_saved") || "Preference saved.");
      if (preferencesFeedbackTimer !== null) clearTimeout(preferencesFeedbackTimer);
      preferencesFeedbackTimer = setTimeout(() => {
        setText("preferences-feedback", "");
        preferencesFeedbackTimer = null;
      }, 2000);
    });
  }

  refreshCatalogStats();
  loadServerUrl();
  refreshStatus();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
