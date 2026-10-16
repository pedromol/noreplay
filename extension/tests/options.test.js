import test from "node:test";
import assert from "node:assert/strict";

import { createBackground } from "../lib/background.js";
import {
  describeAccountResult,
  describeSessionStatus,
  ACCOUNT_STATUS,
} from "../sync/status.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";
import { createMemoryStorage } from "./helpers/memory-storage.js";

test("background message contract used by the options page", async () => {
  const storage = createMemoryStorage();
  const browser = createFakeBrowser();
  browser.storage.local = storage;
  const bg = createBackground({ browser, now: () => 1000 });
  await bg.ready;
  bg.syncClient.login = async () => ({ ok: false, status: 401 });
  bg.syncClient.signup = async () => ({ ok: false, status: 429, retryAfter: "10" });
  bg.syncClient.logout = async () => ({ ok: true, status: 204 });

  let res = await browser.runtime.onMessage.fire({ type: "account-status" });
  assert.deepEqual(res[0], { sessionActive: false, expired: false });

  res = await browser.runtime.onMessage.fire({ type: "account-login", email: "a", password: "badbadbadbad" });
  assert.equal(res[0].status, 401);
  assert.equal(res[0].code, "invalid_credentials");

  res = await browser.runtime.onMessage.fire({ type: "account-signup", email: "a", password: "badbadbadbad" });
  assert.equal(res[0].status, 429);
  assert.equal(res[0].retryAfter, "10");

  res = await browser.runtime.onMessage.fire({ type: "account-logout" });
  assert.equal(res[0].ok, true);
});

test("each failure maps to a DISTINCT options feedback (no silent screen)", () => {
  const invalid = describeAccountResult({ ok: false, status: 401 });
  const rate = describeAccountResult({ ok: false, status: 429, retryAfter: "30" });
  const disabled = describeAccountResult({ ok: false, status: 403, code: "signup_not_allowed" });
  const network = describeAccountResult({ error: true });
  const submitting = describeSessionStatus(ACCOUNT_STATUS.NO_SESSION);

  const statuses = [invalid.status, rate.status, disabled.status, network.status];
  assert.equal(new Set(statuses).size, statuses.length, "all outcomes distinct");
  assert.equal(invalid.status, ACCOUNT_STATUS.INVALID_CREDENTIALS);
  assert.equal(rate.status, ACCOUNT_STATUS.RATE_LIMITED);
  assert.equal(disabled.status, ACCOUNT_STATUS.SIGNUP_DISABLED);
  assert.equal(network.status, ACCOUNT_STATUS.NETWORK_ERROR);

  for (const described of [invalid, rate, disabled, network]) {
    assert.ok(described.message && described.message.length > 0, "every outcome has visible text");
  }
  assert.match(rate.message, /30/, "rate limit surfaces Retry-After");
  assert.ok(submitting.length > 0);
});

test("expired session is reported distinctly from no-session", () => {
  assert.equal(
    describeSessionStatus(ACCOUNT_STATUS.SESSION_EXPIRED),
    "Session expired. Please log in again."
  );
  assert.equal(describeSessionStatus(ACCOUNT_STATUS.NO_SESSION), "No active session");
  assert.equal(describeSessionStatus(ACCOUNT_STATUS.SESSION_ACTIVE), "Session active");
});

test("in-progress feedback exists before a result arrives", () => {
  assert.equal(ACCOUNT_STATUS.SUBMITTING, "submitting");
});
