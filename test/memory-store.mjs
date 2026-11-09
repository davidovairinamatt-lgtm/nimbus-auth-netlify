export function createMemoryStore() {
  const data = new Map();
  let version = 0;

  return {
    async get(key) {
      if (!data.has(key)) return null;
      const entry = data.get(key);
      return { data: structuredClone(entry.value), etag: entry.etag };
    },
    async set(key, value, options = {}) {
      const current = data.get(key);
      if (options.onlyIfNew && current) return { modified: false };
      if (options.onlyIfMatch && (!current || current.etag !== options.onlyIfMatch)) {
        return { modified: false };
      }
      const etag = `"v${++version}"`;
      data.set(key, { value: structuredClone(value), etag });
      return { modified: true, etag };
    },
    async delete(key) {
      data.delete(key);
    },
    keys() {
      return [...data.keys()];
    }
  };
}
