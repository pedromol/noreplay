(() => {
  function signal() {
    try {
      const pending = browser.runtime.sendMessage({ type: "video-signal" });
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* background may be asleep; the next navigation retries */
    }
  }

  window.addEventListener("yt-navigate-finish", signal, true);
  window.addEventListener("yt-page-data-updated", signal, true);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", signal, { once: true });
  } else {
    signal();
  }
})();
