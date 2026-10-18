(() => {
  const browserApi = globalThis.browser || globalThis.chrome;
  if (!browserApi || !browserApi.storage || !browserApi.storage.local) return;

  const core = globalThis.NoReplayHideWatched;
  if (!core) return;

  const SETTINGS_KEY = "settings.hideWatched";
  const CATALOG_KEY = "catalog";
  const SELECTOR = core.CONTAINER_SELECTORS.join(", ");
  const SHELF_SELECTOR = core.SHELF_SELECTORS.join(", ");

  let isEnabled = true;
  let cachedCatalog = {};
  let scheduledScan = false;

  function updateBodyClass() {
    const target = document.body || document.documentElement;
    if (target) {
      target.classList.toggle("noreplay-hide-watched-enabled", isEnabled);
    }
  }

  function evaluateContainer(container) {
    if (!container || typeof container.querySelector !== "function") return;
    const videoId = core.extractVideoIdFromElement(container);
    if (!videoId) {
      container.classList.remove("noreplay-watched-hidden");
      return;
    }

    const record = cachedCatalog[videoId];
    const shouldHide = core.shouldHideVideo(record, true);
    container.classList.toggle("noreplay-watched-hidden", shouldHide);
  }

  function scanAllContainers() {
    const containers = document.querySelectorAll(SELECTOR);
    for (const container of containers) {
      evaluateContainer(container);
    }
    const shelves = document.querySelectorAll(SHELF_SELECTOR);
    for (const shelf of shelves) {
      const shouldHide = core.shouldHideShelf(shelf, isEnabled, cachedCatalog);
      shelf.classList.toggle("noreplay-watched-hidden", shouldHide);
    }
  }

  function requestScan() {
    if (scheduledScan) return;
    scheduledScan = true;
    const scheduleFn =
      typeof window.requestAnimationFrame === "function"
        ? window.requestAnimationFrame
        : (fn) => setTimeout(fn, 16);
    scheduleFn(() => {
      scheduledScan = false;
      scanAllContainers();
    });
  }

  const RELEVANT_SELECTOR = `${SELECTOR}, ${SHELF_SELECTOR}`;

  function isRelevantNode(node) {
    if (!node || node.nodeType !== 1) return false;
    try {
      if (typeof node.matches === "function" && node.matches(RELEVANT_SELECTOR)) return true;
      if (typeof node.querySelector === "function" && node.querySelector(RELEVANT_SELECTOR)) {
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  function handleMutations(mutations) {
    for (const mutation of mutations) {
      if (mutation.type !== "childList" || mutation.addedNodes.length === 0) continue;
      for (const node of mutation.addedNodes) {
        if (isRelevantNode(node)) {
          requestScan();
          return;
        }
      }
    }
  }

  async function init() {
    try {
      const stored = await browserApi.storage.local.get([SETTINGS_KEY, CATALOG_KEY]);
      isEnabled =
        stored && stored[SETTINGS_KEY] !== undefined ? Boolean(stored[SETTINGS_KEY]) : true;
      cachedCatalog = (stored && stored[CATALOG_KEY]) || {};
    } catch {
      isEnabled = true;
      cachedCatalog = {};
    }

    updateBodyClass();
    scanAllContainers();

    if (typeof window.MutationObserver === "function") {
      const observer = new window.MutationObserver(handleMutations);
      const root = document.documentElement || document.body;
      if (root) {
        observer.observe(root, { childList: true, subtree: true });
      }
    }

    if (
      browserApi.storage.onChanged &&
      typeof browserApi.storage.onChanged.addListener === "function"
    ) {
      browserApi.storage.onChanged.addListener((changes, area) => {
        if (area !== "local") return;

        if (changes[SETTINGS_KEY]) {
          isEnabled = Boolean(changes[SETTINGS_KEY].newValue);
          updateBodyClass();
          requestScan();
        }

        if (changes[CATALOG_KEY]) {
          cachedCatalog = changes[CATALOG_KEY].newValue || {};
          requestScan();
        }
      });
    }

    window.addEventListener("yt-navigate-finish", () => requestScan(), true);
    window.addEventListener("yt-page-data-updated", () => requestScan(), true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
