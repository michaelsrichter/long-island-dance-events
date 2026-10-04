'use strict';
/** In-memory stand-in for Azure Table + Blob Storage (same interface as src/lib/store.js). */
function createFakeStore() {
  const tables = new Map();
  const blobs = new Map();
  const tableOf = (name) => {
    if (!tables.has(name)) tables.set(name, new Map());
    return tables.get(name);
  };
  const part = (name, pk) => {
    const t = tableOf(name);
    if (!t.has(pk)) t.set(pk, new Map());
    return t.get(pk);
  };
  const clone = (e) => JSON.parse(JSON.stringify(e));
  const matches = (e, filter) => {
    if (!filter) return true;
    return filter.split(' and ').every((clause) => {
      const m = clause.match(/^(\w+) eq '(.*)'$/);
      if (!m) throw new Error(`fake store cannot parse filter: ${clause}`);
      return String(e[m[1]]) === m[2].replace(/''/g, "'");
    });
  };
  const fake = {
    tables,
    blobs,
    table(name) {
      return {
        async get(pk, rk) {
          const e = part(name, pk).get(rk);
          return e ? clone(e) : null;
        },
        async upsert(entity) {
          part(name, entity.partitionKey).set(entity.rowKey, clone(entity));
        },
        async merge(entity) {
          const p = part(name, entity.partitionKey);
          p.set(entity.rowKey, { ...(p.get(entity.rowKey) || {}), ...clone(entity) });
        },
        async create(entity) {
          const p = part(name, entity.partitionKey);
          if (p.has(entity.rowKey)) return false;
          p.set(entity.rowKey, clone(entity));
          return true;
        },
        async remove(pk, rk) {
          part(name, pk).delete(rk);
        },
        async list(pk, { from, to, limit = 1000, filter } = {}) {
          return [...part(name, pk).values()]
            .filter((e) => (!from || e.rowKey >= from) && (!to || e.rowKey < to) && matches(e, filter))
            .sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0))
            .slice(0, limit)
            .map(clone);
        },
      };
    },
    container(name) {
      return {
        url: (path) => `https://fake.blob.core.windows.net/${name}/${path}`,
        async upload(path, data, contentType, cacheControl) {
          blobs.set(`${name}/${path}`, { data: Buffer.from(data), contentType, cacheControl });
        },
        async download(path) {
          const b = blobs.get(`${name}/${path}`);
          return b ? Buffer.from(b.data) : null;
        },
        async remove(path) {
          blobs.delete(`${name}/${path}`);
        },
      };
    },
    rows(name, pk) {
      return [...part(name, pk).values()].map(clone);
    },
    json(path) {
      const b = blobs.get(path);
      return b ? JSON.parse(b.data.toString('utf8')) : null;
    },
  };
  return fake;
}

module.exports = { createFakeStore };
