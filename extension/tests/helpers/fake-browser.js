export function createEventHook() {
  const listeners = [];
  return {
    addListener(listener, ...rest) {
      listeners.push({ listener, options: rest });
    },
    removeListener(listener) {
      const index = listeners.findIndex((entry) => entry.listener === listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    fire(...args) {
      return Promise.all(listeners.map((entry) => entry.listener(...args)));
    },
    listeners,
  };
}

export function createFakeBrowser({ tabs = {} } = {}) {
  const sentMessages = [];

  return {
    storage: { local: null },
    webNavigation: { onHistoryStateUpdated: createEventHook() },
    runtime: { onMessage: createEventHook() },
    tabs: {
      onRemoved: createEventHook(),
      async get(tabId) {
        if (Object.prototype.hasOwnProperty.call(tabs, tabId)) return { id: tabId, ...tabs[tabId] };
        throw new Error(`no tab ${tabId}`);
      },
      async sendMessage(tabId, message) {
        sentMessages.push({ tabId, message });
      },
    },
    sentMessages,
    setTab(tabId, tab) {
      tabs[tabId] = tab;
    },
  };
}
