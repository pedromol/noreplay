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

function init() {
  byId("signup-form").addEventListener("submit", onSignup);
  byId("login-form").addEventListener("submit", onLogin);
  byId("logout-form").addEventListener("submit", onLogout);
  refreshStatus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
