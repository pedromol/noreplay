(() => {
  const MAX_DELTA_SECONDS = 2;
  const FLUSH_INTERVAL_MS = 5000;

  let media = null;
  let lastTime = null;
  let pendingDelta = 0;
  let pendingDuration = null;

  function onTimeUpdate() {
    if (!media) return;
    const time = media.currentTime;
    if (typeof time !== "number" || !Number.isFinite(time)) {
      lastTime = null;
      return;
    }
    if (lastTime === null) {
      lastTime = time;
      return;
    }
    const delta = time - lastTime;
    lastTime = time;
    if (!(delta > 0) || delta > MAX_DELTA_SECONDS) return;
    const duration = media.duration;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) return;
    pendingDelta += delta;
    pendingDuration = duration;
  }

  function attach() {
    const next = document.querySelector("#movie_player video") || document.querySelector("video");
    if (next === media) {
      lastTime = null;
      return;
    }
    if (media) media.removeEventListener("timeupdate", onTimeUpdate);
    media = next;
    lastTime = null;
    if (media) media.addEventListener("timeupdate", onTimeUpdate);
  }

  function flush() {
    if (pendingDelta <= 0) return;
    const message = {
      type: "playback",
      deltaSeconds: pendingDelta,
      duration: pendingDuration,
    };
    pendingDelta = 0;
    pendingDuration = null;
    try {
      const pending = browser.runtime.sendMessage(message);
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* background may be asleep; the next flush retries */
    }
  }

  setInterval(flush, FLUSH_INTERVAL_MS);
  window.addEventListener("yt-navigate-start", flush, true);
  window.addEventListener("yt-navigate-finish", attach, true);
  window.addEventListener("pagehide", flush);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
})();
