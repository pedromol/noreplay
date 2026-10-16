export const ACCOUNT_STATUS = {
  IDLE: "idle",
  SUBMITTING: "submitting",
  SUCCESS: "success",
  INVALID_CREDENTIALS: "invalid_credentials",
  RATE_LIMITED: "rate_limited",
  SIGNUP_DISABLED: "signup_disabled",
  INVALID_REQUEST: "invalid_request",
  TOO_LARGE: "too_large",
  FORBIDDEN: "forbidden",
  NETWORK_ERROR: "network_error",
  FAILED: "failed",
  SESSION_ACTIVE: "session_active",
  SESSION_EXPIRED: "session_expired",
  NO_SESSION: "no_session",
};

export function describeAccountResult(result, { phase = "login" } = {}) {
  if (!result || result.error) {
    return { status: ACCOUNT_STATUS.NETWORK_ERROR, message: "Network error. Check your connection." };
  }
  if (result.ok) {
    if (phase === "signup") {
      return { status: ACCOUNT_STATUS.SUCCESS, message: "Signup successful. You can log in." };
    }
    if (phase === "logout") {
      return { status: ACCOUNT_STATUS.SUCCESS, message: "Logged out." };
    }
    return { status: ACCOUNT_STATUS.SUCCESS, message: "Logged in." };
  }
  switch (result.status) {
    case 401:
      if (result.code === "session_expired") {
        return { status: ACCOUNT_STATUS.SESSION_EXPIRED, message: "Session expired. Log in again." };
      }
      return { status: ACCOUNT_STATUS.INVALID_CREDENTIALS, message: "Wrong credentials." };
    case 429: {
      const suffix = result.retryAfter ? ` Retry after ${result.retryAfter}s.` : "";
      return { status: ACCOUNT_STATUS.RATE_LIMITED, message: `Too many attempts.${suffix}` };
    }
    case 403:
      if (result.code === "signup_not_allowed") {
        return { status: ACCOUNT_STATUS.SIGNUP_DISABLED, message: "Signup disabled for this email." };
      }
      return { status: ACCOUNT_STATUS.FORBIDDEN, message: "Forbidden." };
    case 400:
      return { status: ACCOUNT_STATUS.INVALID_REQUEST, message: "Invalid request." };
    case 413:
      return { status: ACCOUNT_STATUS.TOO_LARGE, message: "Request too large." };
    default:
      return { status: ACCOUNT_STATUS.FAILED, message: "Request failed." };
  }
}

export function describeSessionStatus(status) {
  switch (status) {
    case ACCOUNT_STATUS.SESSION_ACTIVE:
      return "Session active";
    case ACCOUNT_STATUS.SESSION_EXPIRED:
      return "Session expired. Please log in again.";
    case ACCOUNT_STATUS.NETWORK_ERROR:
      return "Network error checking session.";
    default:
      return "No active session";
  }
}
