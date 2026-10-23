(function (root) {
  const historyPath = root.NoReplayHistoryPath;
  if (!historyPath || typeof historyPath.isHistoryPath !== "function") {
    throw new Error("NoReplay history-path core is required");
  }

  const isHistoryPath = historyPath.isHistoryPath;

  function createHideWatchedController(options) {
    const opts = options || {};
    const core = opts.core;
    if (!core) throw new Error("NoReplay hide-watched core is required");

    const doc = opts.document;
    const win = opts.window || root;
    const getIsEnabled =
      typeof opts.isEnabled === "function" ? opts.isEnabled : () => true;
    const getCatalog = typeof opts.catalog === "function" ? opts.catalog : () => ({});
    const getPathname = typeof opts.pathname === "function" ? opts.pathname : () => "";
    const containerSelector = core.CONTAINER_SELECTORS.join(", ");
    const shelfSelector = core.SHELF_SELECTORS.join(", ");

    let scheduledScan = false;

    function shouldRun() {
      return !isHistoryPath(getPathname());
    }

    function updateBodyClass() {
      if (!doc) return;
      const target = doc.body || doc.documentElement;
      if (!target) return;

      if (!shouldRun()) {
        target.classList.remove("noreplay-hide-watched-enabled");
        return;
      }
      target.classList.toggle("noreplay-hide-watched-enabled", getIsEnabled());
    }

    function evaluateContainer(container, snapshot) {
      if (!shouldRun()) return;
      if (!container || typeof container.querySelector !== "function") return;

      const isEnabled = snapshot ? snapshot.isEnabled : getIsEnabled();
      if (!isEnabled) {
        container.classList.remove("noreplay-watched-hidden");
        return;
      }

      const videoId = core.extractVideoIdFromElement(container);
      if (!videoId) {
        container.classList.remove("noreplay-watched-hidden");
        return;
      }

      const catalog = snapshot ? snapshot.catalog : getCatalog() || {};
      const record = catalog[videoId] || null;
      const shouldHide = core.shouldHideItem(container, record, isEnabled);
      container.classList.toggle("noreplay-watched-hidden", shouldHide);
    }

    function scanAllContainers() {
      updateBodyClass();
      if (!shouldRun() || !doc) return;

      const isEnabled = getIsEnabled();
      const catalog = getCatalog() || {};
      const snapshot = { isEnabled, catalog };

      const containers = doc.querySelectorAll(containerSelector);
      for (const container of containers) {
        evaluateContainer(container, snapshot);
      }

      const shelves = doc.querySelectorAll(shelfSelector);
      for (const shelf of shelves) {
        const shouldHide = core.shouldHideShelf(shelf, isEnabled, catalog);
        shelf.classList.toggle("noreplay-watched-hidden", shouldHide);
      }
    }

    function requestScan() {
      updateBodyClass();
      if (!shouldRun() || scheduledScan) return;
      scheduledScan = true;
      const scheduleFn =
        win && typeof win.requestAnimationFrame === "function"
          ? win.requestAnimationFrame
          : (fn) => win.setTimeout(fn, 16);
      scheduleFn(() => {
        scheduledScan = false;
        scanAllContainers();
      });
    }

    return {
      shouldRun,
      updateBodyClass,
      evaluateContainer,
      scanAllContainers,
      requestScan,
    };
  }

  root.NoReplayHideWatchedController = {
    isHistoryPath,
    createHideWatchedController,
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
