'use strict';
/**
 * Storage access for community data (Azure Table Storage + Blob Storage).
 * SWA managed Functions cannot use managed identity, so the connection string comes from the
 * COMMUNITY_STORAGE app setting (decision P20). Tests replace the backend with an in-memory fake.
 */
const { randomBytes } = require('node:crypto');

const TABLES = {
  users: 'Users',
  comments: 'Comments',
  photos: 'Photos',
  likes: 'Likes',
  likeCounts: 'LikeCounts',
  userItems: 'UserItems',
  flags: 'Flags',
  queue: 'ModQueue',
  log: 'ModLog',
  limits: 'Limits',
  review: 'ReviewState',
};
const CONTAINERS = { pending: 'pending', photos: 'photos', community: 'community' };

class NotConfigured extends Error {}

let backend = null;

function realBackend() {
  const conn = process.env.COMMUNITY_STORAGE;
  if (!conn) throw new NotConfigured('COMMUNITY_STORAGE is not set');
  const { TableClient } = require('@azure/data-tables');
  const { BlobServiceClient } = require('@azure/storage-blob');
  const tables = new Map();
  const blobs = BlobServiceClient.fromConnectionString(conn);
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, TableClient.fromConnectionString(conn, name));
    const t = tables.get(name);
    return {
      async get(pk, rk) {
        try {
          return await t.getEntity(pk, rk);
        } catch (e) {
          if (e && e.statusCode === 404) return null;
          throw e;
        }
      },
      upsert: (entity) => t.upsertEntity(entity, 'Replace'),
      merge: (entity) => t.upsertEntity(entity, 'Merge'),
      async create(entity) {
        try {
          await t.createEntity(entity);
          return true;
        } catch (e) {
          if (e && e.statusCode === 409) return false;
          throw e;
        }
      },
      async remove(pk, rk) {
        try {
          await t.deleteEntity(pk, rk);
        } catch (e) {
          if (!e || e.statusCode !== 404) throw e;
        }
      },
      /** List a partition (optionally a RowKey range), newest first when RowKeys use revTime(). */
      async list(pk, { from, to, limit = 1000, filter } = {}) {
        const parts = [`PartitionKey eq '${pk.replace(/'/g, "''")}'`];
        if (from) parts.push(`RowKey ge '${from.replace(/'/g, "''")}'`);
        if (to) parts.push(`RowKey lt '${to.replace(/'/g, "''")}'`);
        if (filter) parts.push(filter);
        const out = [];
        for await (const e of t.listEntities({ queryOptions: { filter: parts.join(' and ') } })) {
          out.push(e);
          if (out.length >= limit) break;
        }
        return out;
      },
    };
  };
  const container = (name) => {
    const c = blobs.getContainerClient(name);
    return {
      url: (path) => c.getBlockBlobClient(path).url,
      upload: (path, data, contentType, cacheControl) =>
        c.getBlockBlobClient(path).uploadData(data, { blobHTTPHeaders: { blobContentType: contentType, blobCacheControl: cacheControl } }),
      async download(path) {
        try {
          return await c.getBlockBlobClient(path).downloadToBuffer();
        } catch (e) {
          if (e && e.statusCode === 404) return null;
          throw e;
        }
      },
      remove: (path) => c.getBlockBlobClient(path).deleteIfExists(),
    };
  };
  return { table, container };
}

function store() {
  if (!backend) backend = realBackend();
  return backend;
}
const table = (name) => store().table(name);
const container = (name) => store().container(name);

/** Tests only: swap in a fake backend (or null to reset). */
function setBackend(fake) {
  backend = fake;
}

/** RowKey that sorts newest first. */
function revTime(ms = Date.now()) {
  return String(8640000000000000 - ms).padStart(16, '0');
}
function newId() {
  return randomBytes(9).toString('base64url');
}

module.exports = { TABLES, CONTAINERS, table, container, setBackend, revTime, newId, NotConfigured };
