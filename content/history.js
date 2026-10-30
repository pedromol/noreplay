(() => {
  const browserApi = globalThis.browser || globalThis.chrome;
  if (!browserApi || !browserApi.runtime) return;

  const SCROLL_INTERVAL_MS = 2000;
  const SCROLL_DISTANCE_PX = 2000;
  const EMPTY_ATTEMPTS_LIMIT = 60;
  const INITIAL_TIMEOUT_MS = 30000;
  const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

  function gm(key, subs) {
    try {
      if (browserApi && browserApi.i18n && typeof browserApi.i18n.getMessage === "function") {
        const m = browserApi.i18n.getMessage(key, subs);
        if (m) return m;
      }
    } catch {}
    return "";
  }

  function extractIdFromHref(href) {
    if (!href || typeof href !== "string") return null;
    try {
      const url = new URL(href, window.location.origin);
      if (!/(^|\.)youtube\.com$/.test(url.hostname)) return null;
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return id && VIDEO_ID_REGEX.test(id) ? id : null;
      }
      const shortsMatch = url.pathname.match(/^\/shorts\/([^/]+)$/);
      if (shortsMatch) {
        const id = shortsMatch[1];
        return VIDEO_ID_REGEX.test(id) ? id : null;
      }
      return null;
    } catch {
      return null;
    }
  }

  function findDomVideoIds(seen, maxCount = Infinity) {
    const links = document.querySelectorAll('a[href*="/watch"], a[href*="/shorts/"]');
    const newIds = [];
    for (const link of links) {
      if (newIds.length >= maxCount) break;
      const id = extractIdFromHref(link.getAttribute("href") || link.href);
      if (id && !seen.has(id)) {
        seen.add(id);
        newIds.push(id);
      }
    }
    return newIds;
  }

  function isYouTubeLoading() {
    const spinners = document.querySelectorAll(
      "ytd-continuation-item-renderer tp-yt-paper-spinner, " +
      "ytd-continuation-item-renderer #spinner"
    );
    for (const s of spinners) {
      if (s.offsetParent !== null) return true;
    }
    return false;
  }

  function waitUntilIdle(maxWaitMs) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (isYouTubeLoading() && Date.now() - start < maxWaitMs) {
          setTimeout(check, 300);
        } else {
          resolve();
        }
      };
      setTimeout(check, 200);
    });
  }

  function createBanner() {
    const banner = document.createElement("div");
    banner.id = "noreplay-history-banner";

    const title = document.createElement("h3");
    title.textContent = "NoReplay";

    const statusText = document.createElement("div");
    statusText.className = "noreplay-status";
    statusText.id = "noreplay-status-text";
    statusText.textContent = gm("history_banner_starting") || "Starting import...";

    const actions = document.createElement("div");
    actions.id = "noreplay-actions";

    const stopBtn = document.createElement("button");
    stopBtn.type = "button";
    stopBtn.className = "noreplay-btn";
    stopBtn.id = "noreplay-stop-btn";
    stopBtn.textContent = gm("history_banner_stop_btn") || "Stop and save";

    actions.appendChild(stopBtn);
    banner.appendChild(title);
    banner.appendChild(statusText);
    banner.appendChild(actions);

    (document.body || document.documentElement).appendChild(banner);
    return banner;
  }

  async function init() {
    let session = null;
    try {
      session = await browserApi.runtime.sendMessage({ type: "history-import-ready" });
    } catch {
      return;
    }

    if (!session || !session.active) {
      return;
    }

    const target = session.targetCount || 0;
    const banner = createBanner();
    const statusText = banner.querySelector("#noreplay-status-text");
    const actionsContainer = banner.querySelector("#noreplay-actions");
    const stopBtn = banner.querySelector("#noreplay-stop-btn");

    const seenIds = new Set();
    let isStopped = false;
    let emptyScrolls = 0;
    let initialTimer = null;

    function renderProgress() {
      const allText = gm("history_banner_target_all") || "all";
      const targetStr = target > 0 ? String(target) : allText;
      let msg = gm("history_banner_progress", [String(seenIds.size), targetStr]);
      if (!msg) {
        msg = `Collected: ${seenIds.size} of ${targetStr} videos...`;
      }
      statusText.textContent = msg;
    }

    function createCloseTabButton(isSecondary = false) {
      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = isSecondary
        ? "noreplay-btn noreplay-btn-secondary"
        : "noreplay-btn";
      closeBtn.id = "noreplay-close-tab-btn";
      closeBtn.textContent = gm("history_banner_close_tab_btn") || "Close tab";
      closeBtn.addEventListener("click", () => {
        browserApi.runtime.sendMessage({ type: "close-tab" }).catch(() => {});
      });
      return closeBtn;
    }

    function renderEmptyAlert() {
      statusText.textContent =
        gm("history_banner_empty") ||
        "No videos found. Check if you are signed in to your YouTube account.";
      actionsContainer.textContent = "";
      actionsContainer.appendChild(createCloseTabButton(true));
    }

    function renderFinished(total) {
      if (total === 0) {
        renderEmptyAlert();
        return;
      }
      let msg = gm("history_banner_finished", [String(total)]);
      if (!msg) {
        msg = `Import completed! Total of ${total} videos imported.`;
      }
      statusText.textContent = msg;
      actionsContainer.textContent = "";
      actionsContainer.appendChild(createCloseTabButton(false));
    }

    stopBtn.addEventListener("click", () => {
      isStopped = true;
      stopBtn.disabled = true;
      stopBtn.textContent = gm("history_banner_stopping") || "Finishing...";
    });

    initialTimer = setTimeout(async () => {
      if (seenIds.size === 0 && !isStopped) {
        isStopped = true;
        const finishRes = await browserApi.runtime.sendMessage({ type: "history-import-finish" }).catch(() => null);
        renderFinished(finishRes && finishRes.total !== undefined ? finishRes.total : 0);
      }
    }, INITIAL_TIMEOUT_MS);

    async function finish() {
      if (initialTimer) {
        clearTimeout(initialTimer);
        initialTimer = null;
      }
      const finishRes = await browserApi.runtime.sendMessage({ type: "history-import-finish" }).catch(() => null);
      renderFinished(finishRes && finishRes.total !== undefined ? finishRes.total : seenIds.size);
    }

    async function importBatch(ids) {
      const batchRes = await browserApi.runtime.sendMessage({
        type: "history-import-batch",
        videoIds: ids,
      }).catch(() => null);
      return batchRes && batchRes.ok;
    }

    async function step() {
      if (isStopped) {
        await finish();
        return;
      }

      const remaining = target > 0 ? Math.max(0, target - seenIds.size) : Infinity;
      const newIds = findDomVideoIds(seenIds, remaining);

      if (newIds.length > 0) {
        if (initialTimer) {
          clearTimeout(initialTimer);
          initialTimer = null;
        }
        emptyScrolls = 0;

        if (!(await importBatch(newIds))) {
          isStopped = true;
          return;
        }

        renderProgress();

        if (target > 0 && seenIds.size >= target) {
          isStopped = true;
          await finish();
          return;
        }
      } else {
        if (isYouTubeLoading()) {
          emptyScrolls = 0;
          await waitUntilIdle(8000);
          const moreIds = findDomVideoIds(seenIds, remaining);
          if (moreIds.length > 0) {
            if (await importBatch(moreIds)) {
              renderProgress();
            }
            if (target > 0 && seenIds.size >= target) {
              isStopped = true;
              await finish();
              return;
            }
          }
        } else {
          emptyScrolls += 1;
          if (emptyScrolls >= EMPTY_ATTEMPTS_LIMIT) {
            isStopped = true;
            await finish();
            return;
          }
        }
      }

      window.scrollBy({ top: SCROLL_DISTANCE_PX, behavior: "smooth" });
      setTimeout(step, SCROLL_INTERVAL_MS);
    }

    renderProgress();
    setTimeout(step, 400);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
