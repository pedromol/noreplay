(() => {
  const NEXT_BUTTON_SELECTOR = ".ytp-next-button";
  const PLAYER_SELECTOR = "#movie_player";
  const MAX_HOST_RETRIES = 20;
  const HOST_RETRY_MS = 250;

  const skipCore = globalThis.NoReplaySkip;

  let overlay = null;
  let countEl = null;
  let liveRegion = null;
  let hostRetries = 0;
  let hostRetryTimer = null;
  let dismissedVideoId = null;
  let stateEpoch = 0;

  function createSession() {
    const timer = {
      schedule(fn, ms) {
        return window.setTimeout(fn, ms);
      },
      cancel(id) {
        window.clearTimeout(id);
      },
    };
    return skipCore.createSkipSession({
      timer,
      isVisible: () => document.visibilityState === "visible",
      onTick: renderCountdown,
      onSkip: onCountdownExpired,
    });
  }

  const session = createSession();

  function playerHost() {
    const player = document.querySelector(PLAYER_SELECTOR);
    if (player) return player;
    const video = document.querySelector("video");
    return video ? video.parentElement : null;
  }

  function ensureLiveRegion() {
    if (liveRegion && liveRegion.isConnected) return liveRegion;
    liveRegion = document.createElement("div");
    liveRegion.className = "noreplay-sr-only";
    liveRegion.setAttribute("role", "status");
    liveRegion.setAttribute("aria-live", "polite");
    const mount = document.body || document.documentElement;
    if (mount) mount.appendChild(liveRegion);
    return liveRegion;
  }

  function announce(text) {
    const region = ensureLiveRegion();
    if (region) region.textContent = text;
  }

  function clearHostRetry() {
    if (hostRetryTimer !== null) {
      window.clearTimeout(hostRetryTimer);
      hostRetryTimer = null;
    }
    hostRetries = 0;
  }

  function buildOverlay() {
    const root = document.createElement("div");
    root.className = "noreplay-skip-overlay";
    const browser = globalThis.browser || globalThis.chrome;
    function gm(key, subs) {
      try {
        if (browser && browser.i18n && typeof browser.i18n.getMessage === "function") {
          const m = browser.i18n.getMessage(key, subs);
          if (m) return m;
        }
      } catch {}
      return "";
    }
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", gm("skip_overlay_aria_label") || "Already watched video");
    root.setAttribute("tabindex", "-1");

    const title = document.createElement("div");
    title.className = "noreplay-skip-title";
    title.textContent = gm("skip_overlay_title") || "Already watched";

    const count = document.createElement("div");
    count.className = "noreplay-skip-count";

    const notice = document.createElement("div");
    notice.className = "noreplay-skip-notice";
    notice.textContent = gm("skip_overlay_notice") || "The next suggested video will play automatically when it reaches zero.";

    const label = document.createElement("label");
    label.className = "noreplay-skip-exception";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "noreplay-skip-checkbox";

    const checkboxText = document.createElement("span");
    checkboxText.textContent = gm("skip_overlay_never_skip") || "never skip this video";

    label.appendChild(checkbox);
    label.appendChild(checkboxText);

    const hint = document.createElement("div");
    hint.className = "noreplay-skip-hint";
    hint.textContent = gm("skip_overlay_hint") || "Click anywhere to watch again.";

    root.appendChild(title);
    root.appendChild(count);
    root.appendChild(notice);
    root.appendChild(label);
    root.appendChild(hint);

    countEl = count;

    label.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    checkbox.addEventListener("change", () => {
      markNeverSkip();
      userDismiss();
    });

    root.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    root.addEventListener("click", (event) => {
      if (label.contains(event.target)) return;
      event.stopPropagation();
      userDismiss();
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        userDismiss();
        return;
      }
      if (label.contains(event.target)) return;
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        userDismiss();
      }
    });

    return root;
  }

  function renderCountdown(remainingMs) {
    if (!countEl) return;
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const browser = globalThis.browser || globalThis.chrome;
    let msg = "";
    try {
      if (browser && browser.i18n && typeof browser.i18n.getMessage === "function") {
        msg = browser.i18n.getMessage("skip_countdown", [String(seconds)]);
      }
    } catch {}
    if (!msg) msg = `Next video in ${seconds}s…`;
    countEl.textContent = msg;
  }

  function dismissPopup() {
    clearHostRetry();
    session.close();
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    countEl = null;
  }

  function userDismiss() {
    if (session.isActive()) {
      dismissedVideoId = session.current();
    }
    dismissPopup();
  }

  function onCountdownExpired() {
    const next = document.querySelector(NEXT_BUTTON_SELECTOR);
    dismissPopup();
    if (next && typeof next.click === "function") {
      next.click();
    }
  }

  function markNeverSkip() {
    try {
      const pending = browser.runtime.sendMessage({ type: "mark-never-skip" });
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* background may be asleep; the exception is best-effort */
    }
  }

  function showPopup(videoId) {
    if (session.isActive() && session.current() === videoId) return;
    const host = playerHost();
    if (!host) {
      if (hostRetries < MAX_HOST_RETRIES) {
        hostRetries += 1;
        hostRetryTimer = window.setTimeout(() => {
          hostRetryTimer = null;
          showPopup(videoId);
        }, HOST_RETRY_MS);
      }
      return;
    }
    clearHostRetry();
    dismissPopup();
    overlay = buildOverlay();
    host.appendChild(overlay);
    if (!session.open(videoId)) {
      dismissPopup();
      return;
    }
    const browser = globalThis.browser || globalThis.chrome;
    let msg = "";
    try {
      if (browser && browser.i18n && typeof browser.i18n.getMessage === "function") {
        msg = browser.i18n.getMessage("skip_announcement", [String(Math.round(skipCore.SKIP_GRACE_MS / 1000))]);
      }
    } catch {}
    if (!msg) {
      msg =
        "Already watched video. The next suggested video will play automatically in " +
        `${Math.round(skipCore.SKIP_GRACE_MS / 1000)} seconds. ` +
        "Click or press Escape to watch again; use Tab to mark never skip this video.";
    }
    announce(msg);
    try {
      overlay.focus({ preventScroll: true });
    } catch {
      /* focus is a convenience; ignore failures */
    }
  }

  function handleVideoState(message, epoch) {
    if (epoch !== undefined && epoch !== stateEpoch) return;
    const videoId = typeof message.videoId === "string" ? message.videoId : null;
    if (videoId && message.shouldSkip === true) {
      if (videoId === dismissedVideoId) return;
      showPopup(videoId);
      return;
    }
    dismissPopup();
  }

  function requestState() {
    const epoch = stateEpoch;
    try {
      const pending = browser.runtime.sendMessage({ type: "video-state-request" });
      if (pending && typeof pending.then === "function") {
        pending
          .then((state) => {
            if (state) handleVideoState(state, epoch);
          })
          .catch(() => {});
      }
    } catch {
      /* background may be asleep; the next navigation retries */
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "video-state") handleVideoState(message, stateEpoch);
  });

  window.addEventListener(
    "yt-navigate-finish",
    () => {
      stateEpoch += 1;
      dismissedVideoId = null;
      dismissPopup();
      requestState();
    },
    true
  );
  window.addEventListener(
    "yt-page-data-updated",
    () => {
      stateEpoch += 1;
      requestState();
    },
    true
  );

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") session.resume();
    else session.pause();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", requestState, { once: true });
  } else {
    requestState();
  }
})();
