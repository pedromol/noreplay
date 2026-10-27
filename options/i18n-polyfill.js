(function () {
  const browser = globalThis.browser || globalThis.chrome;
  if (typeof browser === "undefined" || !browser.i18n || typeof browser.i18n.getMessage !== "function") {
    return;
  }
  function getMsg(key) {
    try {
      const msg = browser.i18n.getMessage(key);
      return msg || "";
    } catch {
      return "";
    }
  }
  function localize() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (!key) return;
      const msg = getMsg(key);
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (!key) return;
      let msg = getMsg(key);
      if (msg) {
        msg = msg.replace(/\$CODE\$/g, "<code>").replace(/\$\/CODE\$/g, "</code>");
        el.innerHTML = msg;
      }
    });
    document.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (!key) return;
      const msg = getMsg(key);
      if (msg) el.setAttribute("title", msg);
    });
    document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (!key) return;
      const msg = getMsg(key);
      if (msg) el.setAttribute("placeholder", msg);
    });
    // Replace __MSG_...__ in text
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }
    for (const textNode of nodes) {
      const original = textNode.nodeValue;
      if (!original || !original.includes("__MSG_")) continue;
      const replaced = original.replace(/__MSG_([A-Za-z0-9_]+)__/g, (match, key) => {
        const msg = getMsg(key);
        return msg || match;
      });
      if (replaced !== original) {
        textNode.nodeValue = replaced;
      }
    }
    // Replace in attributes
    document.querySelectorAll("*").forEach((el) => {
      for (const attr of Array.from(el.attributes)) {
        if (attr.value && attr.value.includes("__MSG_")) {
          const replaced = attr.value.replace(/__MSG_([A-Za-z0-9_]+)__/g, (match, key) => {
            const msg = getMsg(key);
            return msg || match;
          });
          if (replaced !== attr.value) {
            el.setAttribute(attr.name, replaced);
          }
        }
      }
    });
    const title = getMsg("options_title");
    if (title) document.title = title;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", localize);
  } else {
    localize();
  }
})();
