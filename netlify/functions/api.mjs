import { getStore } from '@netlify/blobs';
import { createHandler } from '../../lib/handler.mjs';

const store = getStore({ name: 'nimbus-auth', consistency: 'strong' });

export default createHandler({
  async get(key) {
    const entry = await store.getWithMetadata(key, { type: 'json', consistency: 'strong' });
    if (!entry) return null;
    return { data: entry.data, etag: entry.etag };
  },
  async set(key, value, options) {
    return store.setJSON(key, value, options);
  },
  async delete(key) {
    return store.delete(key);
  }
});

export const config = {
  path: '/api/*'
};
