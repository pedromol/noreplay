export const DEFAULT_BASE_URL = "https://noreplay.local";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

export function isLoopbackUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function sanitizeBaseUrl(baseUrl, { allowLoopback = true } = {}) {
  if (!baseUrl || typeof baseUrl !== "string") return null;
  let trimmed = baseUrl.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) {
    trimmed = `https://${trimmed}`;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:") return `${parsed.origin}/`;
    if (allowLoopback && parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
      return `${parsed.origin}/`;
    }
    return null;
  } catch {
    return null;
  }
}

export function createSyncClient({ baseUrl, fetch: fetchImpl } = {}) {
  const normalized = sanitizeBaseUrl(baseUrl);
  const origin = normalized ? new URL(normalized).origin : null;
  const fetcher = typeof fetchImpl === "function" ? fetchImpl : (typeof globalThis.fetch === "function" ? globalThis.fetch : null);

  async function request(path, { method = "GET", token, body } = {}) {
    const target = normalized ? `${normalized.replace(/\/$/, "")}${path}` : path;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    let init = { method, headers };
    if (body !== undefined && body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    if (!fetcher) {
      return { ok: false, status: 0, statusText: "", json: async () => ({}), text: async () => "" };
    }
    try {
      const response = await fetcher(target, init);
      const result = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        retryAfter: response.headers.get("Retry-After"),
      };
      result.json = async () => {
        try {
          return await response.json();
        } catch {
          return {};
        }
      };
      result.text = async () => {
        try {
          return await response.text();
        } catch {
          return "";
        }
      };
      return result;
    } catch (e) {
      console.error("sync request network error:", target, e && e.message ? e.message : "network error");
      return { ok: false, status: 0, statusText: e && e.message ? e.message : "network error", json: async () => ({}), text: async () => "" };
    }
  }

  async function signup({ email, password }) {
    return request("/v1/signup", { method: "POST", body: { email, password } });
  }

  async function login({ email, password }) {
    return request("/v1/login", { method: "POST", body: { email, password } });
  }

  async function logout(token) {
    return request("/v1/logout", { method: "POST", token });
  }

  async function push(token, records) {
    return request("/v1/sync/push", { method: "POST", token, body: { records } });
  }

  async function pull(token) {
    return request("/v1/sync/pull", { method: "GET", token });
  }

  return {
    baseUrl: normalized,
    origin,
    request,
    signup,
    login,
    logout,
    push,
    pull,
  };
}
