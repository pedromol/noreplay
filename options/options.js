const browser = globalThis.browser || globalThis.chrome;

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const el = byId(id);
  if (el) el.textContent = text || "";
}

function getMsg(key, substitutions) {
  try {
    if (browser && browser.i18n && typeof browser.i18n.getMessage === "function") {
      const msg = browser.i18n.getMessage(key, substitutions);
      if (msg) return msg;
    }
  } catch {}
  return "";
}

function t(key, substitutions) {
  return getMsg(key, substitutions);
}

function localize() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (!key) return;
    const msg = t(key);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (!key) return;
    const msg = t(key);
    if (msg) el.setAttribute("title", msg);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (!key) return;
    const msg = t(key);
    if (msg) el.setAttribute("placeholder", msg);
  });
  const title = t("options_title");
  if (title) document.title = title;
}

export async function send(message) {
  try {
    return await browser.runtime.sendMessage(message);
  } catch {
    return { error: true };
  }
}

export async function refreshCatalogStats() {
  const stats = await send({ type: "catalog-stats" });
  if (stats && typeof stats.watched === "number") {
    setText("stat-watched", String(stats.watched));
    setText("stat-never-skip", String(stats.neverSkip));
    return stats;
  }
  return null;
}

export async function exportCatalogBackup() {
  setText("catalog-feedback", t("catalog_exporting") || "Exporting catalog...");
  const res = await send({ type: "catalog-export" });
  if (!res || !Array.isArray(res.records)) {
    setText("catalog-feedback", t("catalog_export_error") || "Error exporting catalog.");
    return;
  }
  try {
    const jsonStr = JSON.stringify(res.records, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const a = document.createElement("a");
    a.href = url;
    a.download = `noreplay-catalog-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    let msg = t("catalog_export_success") || "Backup exported successfully ($COUNT$ records).";
    msg = msg.replace("$COUNT$", String(res.records.length));
    setText("catalog-feedback", msg);
    setTimeout(() => setText("catalog-feedback", ""), 3500);
  } catch (err) {
    let msg = t("catalog_export_file_error") || "Error generating backup file: $ERROR$";
    msg = msg.replace("$ERROR$", err.message || "unknown");
    setText("catalog-feedback", msg);
  }
}

export async function handleCatalogImportFile(file) {
  if (!file) return;
  setText("catalog-feedback", t("catalog_import_reading") || "Reading file...");
  try {
    const text = await file.text();
    const records = JSON.parse(text);
    if (!Array.isArray(records)) {
      setText("catalog-feedback", t("catalog_import_invalid_format") || "Invalid format.");
      return;
    }
    const res = await send({ type: "catalog-import", records });
    if (res && typeof res.imported === "number") {
      let msg = t("catalog_import_success") || "$IMPORTED$ records imported successfully! (Total in catalog: $TOTAL$)";
      msg = msg.replace("$IMPORTED$", String(res.imported)).replace("$TOTAL$", String(res.total));
      setText("catalog-feedback", msg);
      await refreshCatalogStats();
      setTimeout(() => setText("catalog-feedback", ""), 4000);
    } else {
      setText("catalog-feedback", t("catalog_import_fail") || "Failed to import records.");
    }
  } catch (err) {
    let msg = t("catalog_import_processing_error") || "Error processing JSON file: $ERROR$";
    msg = msg.replace("$ERROR$", err.message || "unknown");
    setText("catalog-feedback", msg);
  }
}

export async function handleCatalogClear() {
  const confirmed = window.confirm(t("catalog_clear_confirm") || "Are you sure?");
  if (!confirmed) return;
  const res = await send({ type: "catalog-clear" });
  if (res && res.ok) {
    setText("catalog-feedback", t("catalog_cleared") || "Catalog cleared.");
    await refreshCatalogStats();
    setTimeout(() => setText("catalog-feedback", ""), 3500);
  } else {
    setText("catalog-feedback", t("catalog_clear_error") || "Error clearing catalog.");
  }
}

const HIDE_WATCHED_KEY = "settings.hideWatched";
export { HIDE_WATCHED_KEY };

export async function loadHideWatchedSetting(storageArea) {
  try {
    const stored = await storageArea.get(HIDE_WATCHED_KEY);
    const val = stored ? stored[HIDE_WATCHED_KEY] : undefined;
    if (val === undefined || val === null) {
      return true;
    }
    return Boolean(val);
  } catch {
    return true;
  }
}

export async function saveHideWatchedSetting(storageArea, enabled) {
  try {
    if (enabled) {
      await storageArea.set({ [HIDE_WATCHED_KEY]: true });
    } else {
      await storageArea.set({ [HIDE_WATCHED_KEY]: false });
    }
  } catch {
    /* ignore */
  }
}

async function setupHideWatched() {
  const toggle = byId("hide-watched-toggle");
  if (!toggle) return;
  if (browser && browser.storage && browser.storage.local) {
    try {
      const enabled = await loadHideWatchedSetting(browser.storage.local);
      toggle.checked = enabled;
    } catch {}
  }
  toggle.addEventListener("change", async (e) => {
    if (!(browser && browser.storage && browser.storage.local)) return;
    try {
      await saveHideWatchedSetting(browser.storage.local, e.target.checked);
      setText("hide-watched-feedback", t("hide_watched_saved") || "Saved.");
      setTimeout(() => setText("hide-watched-feedback", ""), 1500);
    } catch {
      setText("hide-watched-feedback", t("hide_watched_error") || "Error saving.");
    }
  });
}

export async function startHistoryImport() {
  const targetSelect = byId("history-target");
  const targetCount = targetSelect ? parseInt(targetSelect.value, 10) : 100;
  const feedback = byId("history-import-feedback");
  if (feedback) setText("history-import-feedback", t("history_import_opening") || "Opening history...");
  const res = await send({ type: "start-history-import", targetCount });
  if (res && res.ok) {
    if (feedback) setText("history-import-feedback", t("history_import_opened") || "Opened YouTube History tab. Track progress on YouTube.");
    setTimeout(() => {
      if (feedback) setText("history-import-feedback", "");
    }, 4000);
  } else {
    if (feedback) setText("history-import-feedback", t("history_import_error") || "Error starting import.");
  }
}

async function init() {
  localize();
  await refreshCatalogStats();
  await setupHideWatched();

  const exportBtn = byId("export-catalog");
  if (exportBtn) exportBtn.addEventListener("click", exportCatalogBackup);

  let selectedImportFile = null;
  const importInput = byId("import-catalog-file");
  const pickBtn = byId("import-catalog-pick");
  const fileNameEl = byId("import-file-name");
  const submitBtn = byId("import-catalog-submit");

  function setFile(file) {
    selectedImportFile = file || null;
    if (fileNameEl) {
      if (file) {
        fileNameEl.textContent = "📄 " + file.name;
        fileNameEl.classList.add("has-file");
      } else {
        fileNameEl.textContent = t("catalog_import_no_file") || "No file selected";
        fileNameEl.classList.remove("has-file");
      }
    }
    if (submitBtn) {
      submitBtn.disabled = !file;
    }
  }

  if (pickBtn && importInput) {
    pickBtn.addEventListener("click", () => importInput.click());
  }

  if (importInput) {
    importInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      setFile(file);
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      if (!selectedImportFile && importInput) {
        importInput.click();
        return;
      }
      if (selectedImportFile) {
        await handleCatalogImportFile(selectedImportFile);
        if (importInput) importInput.value = "";
        setFile(null);
      }
    });
  }

  const clearBtn = byId("clear-catalog");
  if (clearBtn) clearBtn.addEventListener("click", handleCatalogClear);

  const historyBtn = byId("start-history-import");
  if (historyBtn) historyBtn.addEventListener("click", startHistoryImport);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}
