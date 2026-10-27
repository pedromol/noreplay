(() => {
  const browserApi = globalThis.browser || globalThis.chrome;
  if (!browserApi || !browserApi.storage || !browserApi.storage.local) return;

  const core = globalThis.NoReplayHideWatched;
  const controllerApi = globalThis.NoReplayHideWatchedController;
  if (!core || !controllerApi) return;

  const SETTINGS_KEY = "settings.hideWatched";
  const CATALOG_KEY = "catalog";
  const SELECTOR = core.CONTAINER_SELECTORS.join(", ");
  const SHELF_SELECTOR = core.SHELF_SELECTORS.join(", ");
  const RELEVANT_SELECTOR = `${SELECTOR}, ${SHELF_SELECTOR}`;

  let isEnabled = true;
  let cachedCatalog = {};

  const controller = controllerApi.createHideWatchedController({
    core,
    document,
    window,
    isEnabled: () => isEnabled,
    catalog: () => cachedCatalog,
    pathname: () => window.location.pathname,
  });

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
      if (mutation.type === "attributes") {
        const container = mutation.target.closest?.(SELECTOR);
        if (container) {
          controller.requestScan();
          return;
        }
        continue;
      }
      if (mutation.type !== "childList" || mutation.addedNodes.length === 0) continue;
      for (const node of mutation.addedNodes) {
        if (isRelevantNode(node)) {
          controller.requestScan();
          return;
        }
        if (node.nodeType === 1 && mutation.target.closest?.(SELECTOR)) {
          controller.requestScan();
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

    controller.updateBodyClass();
    controller.scanAllContainers();

    if (typeof window.MutationObserver === "function") {
      const observer = new window.MutationObserver(handleMutations);
      const root = document.documentElement || document.body;
      if (root) {
        observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["href"],
        });
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
          controller.updateBodyClass();
          controller.requestScan();
        }

        if (changes[CATALOG_KEY]) {
          cachedCatalog = changes[CATALOG_KEY].newValue || {};
          controller.requestScan();
        }
      });
    }

    window.addEventListener("yt-navigate-finish", () => controller.requestScan(), true);
    window.addEventListener("yt-page-data-updated", () => controller.requestScan(), true);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
