export function createMemoryStorage(initial = {}) {
  let data = structuredClone(initial);

  return {
    async get(keys) {
      if (typeof keys === "string") {
        return keys in data ? { [keys]: structuredClone(data[keys]) } : {};
      }
      if (Array.isArray(keys)) {
        const result = {};
        for (const key of keys) {
          if (key in data) result[key] = structuredClone(data[key]);
        }
        return result;
      }
      return structuredClone(data);
    },
    async set(items) {
      data = { ...data, ...structuredClone(items) };
    },
    async remove(keys) {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const key of list) delete data[key];
    },
    snapshot() {
      return structuredClone(data);
    },
  };
}
