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

async function send(message) {
  try {
    return await browser.runtime.sendMessage(message);
  } catch {
    return { error: true };
  }
}

let submitting = false;

async function refreshStatus() {
  const res = await send({ type: "account-status" });
  if (!res || res.error) {
    setText("session-status", describeSessionStatus(ACCOUNT_STATUS.NETWORK_ERROR));
    setVisible("logout-form", false);
    return;
  }
  if (res.sessionActive) {
    setText("session-status", describeSessionStatus(ACCOUNT_STATUS.SESSION_ACTIVE));
    setVisible("logout-form", true);
    setVisible("login-form", false);
    setVisible("signup-form", false);
  } else {
    const status = res.expired ? ACCOUNT_STATUS.SESSION_EXPIRED : ACCOUNT_STATUS.NO_SESSION;
    setText("session-status", describeSessionStatus(status));
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

  const hideWatchedInput = byId("setting-hide-watched");
  if (hideWatchedInput && browser && browser.storage && browser.storage.local) {
    loadHideWatchedSetting(browser.storage.local).then((enabled) => {
      hideWatchedInput.checked = enabled;
    });
    hideWatchedInput.addEventListener("change", async (e) => {
      await saveHideWatchedSetting(browser.storage.local, e.target.checked);
      setText("preferences-feedback", "Preferência salva.");
      setTimeout(() => setText("preferences-feedback", ""), 2000);
    });
  }

  refreshStatus();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
