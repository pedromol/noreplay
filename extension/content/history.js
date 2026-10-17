(() => {
  const browserApi = globalThis.browser || globalThis.chrome;
  if (!browserApi || !browserApi.runtime) return;

  const SCROLL_INTERVAL_MS = 500;
  const EMPTY_ATTEMPTS_LIMIT = 8;
  const INITIAL_TIMEOUT_MS = 6000;
  const VIDEO_ID_REGEX = /^[A-Za-z0-9_-]{11}$/;

  function extractIdFromHref(href) {
    if (!href || typeof href !== "string") return null;
    try {
      const url = new URL(href, window.location.origin);
      if (url.pathname !== "/watch") return null;
      const id = url.searchParams.get("v");
      return id && VIDEO_ID_REGEX.test(id) ? id : null;
    } catch {
      return null;
    }
  }

  function findDomVideoIds(seen) {
    const links = document.querySelectorAll('a[href*="/watch?v="]');
    const newIds = [];
    for (const link of links) {
      const id = extractIdFromHref(link.getAttribute("href") || link.href);
      if (id && !seen.has(id)) {
        seen.add(id);
        newIds.push(id);
      }
    }
    return newIds;
  }

  function createBanner() {
    const banner = document.createElement("div");
    banner.id = "noreplay-history-banner";
    banner.innerHTML = `
      <h3>NoReplay</h3>
      <div class="noreplay-status" id="noreplay-status-text">Iniciando importação...</div>
      <div id="noreplay-actions">
        <button type="button" class="noreplay-btn" id="noreplay-stop-btn">Parar e salvar</button>
      </div>
    `;
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
      const targetStr = target > 0 ? String(target) : "todos";
      statusText.textContent = `Coletados: ${seenIds.size} de ${targetStr} vídeos...`;
    }

    function renderFinished(total) {
      statusText.textContent = `Importação concluída! Total de ${total} vídeos importados.`;
      actionsContainer.innerHTML = `
        <button type="button" class="noreplay-btn" id="noreplay-close-tab-btn">Fechar aba</button>
      `;
      const closeBtn = banner.querySelector("#noreplay-close-tab-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          browserApi.runtime.sendMessage({ type: "close-tab" }).catch(() => {});
        });
      }
    }

    function renderEmptyAlert() {
      statusText.textContent = "Nenhum vídeo encontrado. Verifique se você está conectado à sua conta do YouTube.";
      actionsContainer.innerHTML = `
        <button type="button" class="noreplay-btn noreplay-btn-secondary" id="noreplay-close-tab-btn">Fechar aba</button>
      `;
      const closeBtn = banner.querySelector("#noreplay-close-tab-btn");
      if (closeBtn) {
        closeBtn.addEventListener("click", () => {
          browserApi.runtime.sendMessage({ type: "close-tab" }).catch(() => {});
        });
      }
    }

    stopBtn.addEventListener("click", () => {
      isStopped = true;
    });

    initialTimer = setTimeout(() => {
      if (seenIds.size === 0 && !isStopped) {
        isStopped = true;
        renderEmptyAlert();
      }
    }, INITIAL_TIMEOUT_MS);

    async function step() {
      if (isStopped) {
        if (initialTimer) clearTimeout(initialTimer);
        const finishRes = await browserApi.runtime.sendMessage({ type: "history-import-finish" });
        renderFinished(finishRes && finishRes.total !== undefined ? finishRes.total : seenIds.size);
        return;
      }

      const newIds = findDomVideoIds(seenIds);
      if (newIds.length > 0) {
        if (initialTimer) {
          clearTimeout(initialTimer);
          initialTimer = null;
        }
        emptyScrolls = 0;
        await browserApi.runtime.sendMessage({
          type: "history-import-batch",
          videoIds: newIds,
        }).catch(() => {});
        renderProgress();

        if (target > 0 && seenIds.size >= target) {
          isStopped = true;
          const finishRes = await browserApi.runtime.sendMessage({ type: "history-import-finish" });
          renderFinished(finishRes && finishRes.total !== undefined ? finishRes.total : seenIds.size);
          return;
        }
      } else {
        emptyScrolls += 1;
        if (emptyScrolls >= EMPTY_ATTEMPTS_LIMIT) {
          isStopped = true;
          const finishRes = await browserApi.runtime.sendMessage({ type: "history-import-finish" });
          renderFinished(finishRes && finishRes.total !== undefined ? finishRes.total : seenIds.size);
          return;
        }
      }

      window.scrollBy({ top: 1200, behavior: "smooth" });
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
