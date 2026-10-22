import { describeAccountResult, describeSessionStatus, ACCOUNT_STATUS } from "../sync/status.js";

const browser = globalThis.browser || globalThis.chrome;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text || "";
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
  setText("catalog-feedback", "Exportando catálogo...");
  const res = await send({ type: "catalog-export" });
  if (!res || !Array.isArray(res.records)) {
    setText("catalog-feedback", "Erro ao exportar catálogo.");
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
    setText("catalog-feedback", `Backup exportado com sucesso (${res.records.length} registros).`);
    setTimeout(() => setText("catalog-feedback", ""), 3500);
  } catch (err) {
    setText("catalog-feedback", `Erro ao gerar arquivo de backup: ${err.message || "desconhecido"}`);
  }
}

export async function handleCatalogImportFile(file) {
  if (!file) return;
  setText("catalog-feedback", "Lendo arquivo...");
  try {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) {
      setText("catalog-feedback", "Formato inválido: o arquivo deve conter uma lista JSON de registros.");
      return;
    }
    const res = await send({ type: "catalog-import", records });
    if (res && typeof res.imported === "number") {
      setText("catalog-feedback", `${res.imported} registros importados com sucesso! (Total no catálogo: ${res.total})`);
      await refreshCatalogStats();
      setTimeout(() => setText("catalog-feedback", ""), 4000);
    } else {
      setText("catalog-feedback", "Falha ao importar registros.");
    }
  } catch (err) {
    setText("catalog-feedback", `Erro ao processar arquivo JSON: ${err.message || "desconhecido"}`);
  }
}

export async function handleCatalogClear() {
  const confirmed = window.confirm("Tem certeza que deseja apagar todo o catálogo local de vídeos assistidos?");
  if (!confirmed) return;
  const res = await send({ type: "catalog-clear" });
  if (res && res.ok) {
    setText("catalog-feedback", "Catálogo local limpo com sucesso.");
    await refreshCatalogStats();
    setTimeout(() => setText("catalog-feedback", ""), 3500);
  } else {
    setText("catalog-feedback", "Erro ao limpar catálogo.");
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
  setText("server-url-feedback", "Salvando URL...");
  const res = await send({ type: "set-server-url", baseUrl: url });
  if (res && res.ok) {
    setText("server-url-feedback", "URL do servidor salva.");
    if (input) input.value = res.baseUrl;
    await refreshStatus();
    setTimeout(() => setText("server-url-feedback", ""), 2500);
  } else {
    setText("server-url-feedback", "Erro ao salvar URL.");
  }
}

export async function refreshStatus() {
  const res = await send({ type: "account-status" });
  if (!res || res.error) {
    setText("session-status", `${describeSessionStatus(ACCOUNT_STATUS.NETWORK_ERROR)} (Modo Local Offline ativo)`);
    setVisible("logout-form", false);
    setVisible("login-form", true);
    setVisible("signup-form", true);
    return;
  }
  if (res.sessionActive) {
    setText("session-status", `${describeSessionStatus(ACCOUNT_STATUS.SESSION_ACTIVE)} — Sincronizando com nuvem`);
    setVisible("logout-form", true);
    setVisible("login-form", false);
    setVisible("signup-form", false);
  } else {
    const status = res.expired ? ACCOUNT_STATUS.SESSION_EXPIRED : ACCOUNT_STATUS.NO_SESSION;
    const baseText = describeSessionStatus(status);
    const suffix = res.expired ? "" : " — Modo Local (Offline) ativo";
    setText("session-status", `${baseText}${suffix}`);
    setVisible("logout-form", false);
    setVisible("login-form", true);
    setVisible("signup-form", true);
  }
}

async function runPhase(phase, message, formId, feedbackId) {
  if (submitting) return;
  submitting = true;
  setText(feedbackId, "Submitting...");
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
  setText("history-import-feedback", "Abrindo página de histórico...");
  const res = await send({ type: "start-history-import", targetCount: target });
  submitting = false;
  if (btn) btn.disabled = false;
  if (res && res.ok) {
    setText("history-import-feedback", "Histórico aberto em nova aba. Acompanhe o progresso no YouTube.");
  } else {
    setText("history-import-feedback", "Erro ao iniciar importação do histórico.");
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
      setText("preferences-feedback", "Preferência salva.");
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
