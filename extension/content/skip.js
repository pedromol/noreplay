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
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", "Vídeo já assistido");
    root.setAttribute("tabindex", "-1");

    const title = document.createElement("div");
    title.className = "noreplay-skip-title";
    title.textContent = "Vídeo já assistido";

    const count = document.createElement("div");
    count.className = "noreplay-skip-count";

    const notice = document.createElement("div");
    notice.className = "noreplay-skip-notice";
    notice.textContent = "O próximo vídeo sugerido começa sozinho ao chegar a zero.";

    const label = document.createElement("label");
    label.className = "noreplay-skip-exception";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "noreplay-skip-checkbox";

    const checkboxText = document.createElement("span");
    checkboxText.textContent = "nunca pular esse vídeo";

    label.appendChild(checkbox);
    label.appendChild(checkboxText);

    const hint = document.createElement("div");
    hint.className = "noreplay-skip-hint";
    hint.textContent = "Clique em qualquer lugar para assistir de novo.";

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
      dismissPopup();
    });

    root.addEventListener("mousedown", (event) => {
      event.stopPropagation();
    });

    root.addEventListener("click", (event) => {
      if (label.contains(event.target)) return;
      event.stopPropagation();
      dismissPopup();
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissPopup();
        return;
      }
      if (label.contains(event.target)) return;
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        event.stopPropagation();
        dismissPopup();
      }
    });

    return root;
  }

  function renderCountdown(remainingMs) {
    if (!countEl) return;
    const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
    countEl.textContent = `Próximo vídeo em ${seconds}s…`;
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
    announce(
      "Vídeo já assistido. O próximo vídeo sugerido começa sozinho em " +
        `${Math.round(skipCore.SKIP_GRACE_MS / 1000)} segundos. ` +
        "Clique ou pressione Escape para assistir de novo; use Tab para marcar nunca pular esse vídeo."
    );
    try {
      overlay.focus({ preventScroll: true });
    } catch {
      /* focus is a convenience; ignore failures */
    }
  }

  function handleVideoState(message) {
    const videoId = typeof message.videoId === "string" ? message.videoId : null;
    if (videoId && message.shouldSkip === true) {
      showPopup(videoId);
      return;
    }
    dismissPopup();
  }

  function requestState() {
    try {
      const pending = browser.runtime.sendMessage({ type: "video-state-request" });
      if (pending && typeof pending.then === "function") {
        pending
          .then((state) => {
            if (state) handleVideoState(state);
          })
          .catch(() => {});
      }
    } catch {
      /* background may be asleep; the next navigation retries */
    }
  }

  browser.runtime.onMessage.addListener((message) => {
    if (message && message.type === "video-state") handleVideoState(message);
  });

  function onNavigation() {
    requestState();
  }

  window.addEventListener("yt-navigate-finish", onNavigation, true);
  window.addEventListener("yt-page-data-updated", onNavigation, true);

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
