'use strict';
/**
 * Photo files: approved photos are in the public "photos" container; pending, hidden and rejected
 * ones stay in the private "pending" container, so taking a photo down also stops serving it.
 */
const { container, CONTAINERS } = require('./store');
const { photoPaths } = require('./readmodel');

// Short enough that a photo taken down by a moderator or a report stops being served within the hour.
const PUBLIC_PHOTO_CACHE = 'public, max-age=3600';

/** Approve: copy the private files to the public container. */
async function publishPhoto(key, photoId) {
  for (const path of Object.values(photoPaths(key, photoId))) {
    const data = await container(CONTAINERS.pending).download(path);
    if (data) await container(CONTAINERS.photos).upload(path, data, 'image/webp', PUBLIC_PHOTO_CACHE);
    await container(CONTAINERS.pending).remove(path);
  }
}

/** Hide or reject: move the public files back to the private container (kept, so a moderator can approve again). */
async function unpublishPhoto(key, photoId) {
  for (const path of Object.values(photoPaths(key, photoId))) {
    const data = await container(CONTAINERS.photos).download(path);
    if (data) await container(CONTAINERS.pending).upload(path, data, 'image/webp', 'no-store');
    await container(CONTAINERS.photos).remove(path);
  }
}

module.exports = { publishPhoto, unpublishPhoto, PUBLIC_PHOTO_CACHE };
