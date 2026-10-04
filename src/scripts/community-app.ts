/**
 * Community panel: notes, corrections, photos and reports for one page (likes are in reactions.ts).
 * All user text is inserted with textContent (never innerHTML).
 */
import { loginUrl, rememberAccount } from './account-state';
type Comment = { id: string; name: string; text: string; at: string; date?: string };
type Photo = { id: string; by: string; caption: string; alt: string; w: number; h: number; at: string; src: { s: string; m: string; l: string } };
type Doc = { likes: number; comments: Comment[]; photos: Photo[] };
type Me = { displayName: string; status: string; needsProfile: boolean; canPostPhotos: boolean; adult: boolean; isAdmin: boolean };

const EMPTY: Doc = { likes: 0, comments: [], photos: [] };
const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

function q<T extends Element>(root: Element, sel: string): T | null {
  return root.querySelector<T>(sel);
}

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; data: any }> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { Accept: 'application/json', ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

async function signedIn(): Promise<boolean> {
  try {
    const res = await fetch('/.auth/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return false;
    const body = await res.json();
    return Boolean(body && body.clientPrincipal);
  } catch {
    return false;
  }
}

function addText(el: HTMLElement, text: string) {
  text.split('\n').forEach((line, i) => {
    if (i) el.appendChild(document.createElement('br'));
    el.appendChild(document.createTextNode(line));
  });
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt.format(d);
}

/** Shrink to at most 2560 px and re-encode as JPEG in the browser (this also drops EXIF/GPS). */
async function shrink(file: File): Promise<Blob> {
  if (!('createImageBitmap' in window)) return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const scale = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob ?? file;
  } catch {
    return file;
  }
}

export function init(panel: HTMLElement) {
  const key = panel.dataset.key!;
  const src = panel.dataset.src!;
  const date = panel.dataset.date || '';
  const status = q<HTMLElement>(panel, '[data-status]')!;
  const commentList = q<HTMLOListElement>(panel, '[data-comment-list]')!;
  const photoList = q<HTMLElement>(panel, '[data-photo-list]')!;
  const empty = q<HTMLElement>(panel, '[data-empty]')!;
  const signedOut = q<HTMLElement>(panel, '[data-signed-out]')!;
  const member = q<HTMLElement>(panel, '[data-signed-in]')!;
  const profileNeeded = q<HTMLElement>(panel, '[data-profile-needed]')!;
  const blocked = q<HTMLElement>(panel, '[data-blocked]')!;
  const commentForm = q<HTMLFormElement>(panel, '[data-comment-form]')!;
  const photoForm = q<HTMLFormElement>(panel, '[data-photo-form]');
  const photoNeeds = q<HTMLElement>(panel, '[data-photo-needs]');
  const preview = q<HTMLCanvasElement>(panel, '[data-photo-preview]');
  const reportDialog = q<HTMLDialogElement>(panel, '[data-report-dialog]')!;
  const reportForm = q<HTMLFormElement>(panel, '[data-report-form]')!;
  const signin = q<HTMLAnchorElement>(panel, '[data-signin]')!;
  const panelLoading = q<HTMLElement>(panel, '[data-panel-loading]');

  signin.href = loginUrl(`${location.pathname}#community`);

  let me: Me | null = null;
  let reportTarget: { itemType: 'comment' | 'photo'; itemId: string } | null = null;

  const say = (text: string) => {
    status.textContent = text;
  };

  function reportButton(itemType: 'comment' | 'photo', itemId: string) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'link-btn community__report';
    b.textContent = 'Report';
    b.addEventListener('click', () => {
      if (!me) {
        say('Please sign in to report a post.');
        signin.focus();
        return;
      }
      reportTarget = { itemType, itemId };
      reportForm.reset();
      reportDialog.showModal();
    });
    return b;
  }

  function render(doc: Doc) {
    commentList.replaceChildren();
    for (const c of doc.comments) {
      const li = document.createElement('li');
      li.className = 'community__comment';
      const meta = document.createElement('p');
      meta.className = 'community__meta';
      const who = document.createElement('strong');
      who.textContent = c.name;
      meta.append(who, document.createTextNode(` · ${when(c.at)}`));
      if (c.date) meta.append(document.createTextNode(` · about ${when(`${c.date}T12:00:00Z`)}`));
      const body = document.createElement('p');
      body.className = 'community__text';
      addText(body, c.text);
      li.append(meta, body, reportButton('comment', c.id));
      commentList.appendChild(li);
    }
    commentList.hidden = doc.comments.length === 0;

    photoList.replaceChildren();
    for (const p of doc.photos) {
      const fig = document.createElement('figure');
      fig.className = 'community__photo';
      const a = document.createElement('a');
      a.href = p.src.l;
      a.target = '_blank';
      a.rel = 'noopener';
      const img = document.createElement('img');
      img.src = p.src.s;
      img.alt = p.alt;
      img.loading = 'lazy';
      img.decoding = 'async';
      if (p.w && p.h) {
        const scale = Math.min(1, 480 / Math.max(p.w, p.h));
        img.width = Math.round(p.w * scale);
        img.height = Math.round(p.h * scale);
      }
      const hint = document.createElement('span');
      hint.className = 'visually-hidden';
      hint.textContent = ' (opens the full photo in a new tab)';
      a.append(img, hint);
      const cap = document.createElement('figcaption');
      cap.textContent = `${p.caption ? `${p.caption} · ` : ''}Photo by ${p.by}`;
      fig.append(a, cap, reportButton('photo', p.id));
      photoList.appendChild(fig);
    }
    photoList.hidden = doc.photos.length === 0;
    empty.hidden = doc.comments.length + doc.photos.length > 0;
  }

  async function load(fresh = false) {
    try {
      const res = await fetch(src, { cache: fresh ? 'reload' : 'default', credentials: 'omit' });
      render(res.ok ? ((await res.json()) as Doc) : EMPTY);
    } catch {
      render(EMPTY);
    }
    if (panelLoading) panelLoading.hidden = true;
  }

  /** Disable a button and show a short "working" label until `work` finishes. */
  async function busy<T>(btn: HTMLButtonElement, label: string, work: () => Promise<T>): Promise<T> {
    const kids = Array.from(btn.childNodes);
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = label;
    try {
      return await work();
    } finally {
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.replaceChildren(...kids);
    }
  }

  function applyMe() {
    const on = Boolean(me);
    signedOut.hidden = on;
    member.hidden = !on;
    if (!me) return;
    rememberAccount({ name: me.displayName || 'You', admin: me.isAdmin });
    profileNeeded.hidden = !me.needsProfile;
    const isBlocked = me.status === 'banned' || me.status === 'under13';
    blocked.hidden = !isBlocked;
    blocked.textContent = me.status === 'banned' ? 'Your account cannot post right now. See the community rules for questions.' : me.status === 'under13' ? 'Sorry, you must be 13 or older to take part.' : '';
    const canPost = !me.needsProfile && !isBlocked;
    commentForm.hidden = !canPost;
    const photoDetails = q<HTMLElement>(panel, '[data-photo-details]');
    if (photoDetails) photoDetails.hidden = !canPost;
    if (photoForm && photoNeeds) {
      photoNeeds.hidden = me.canPostPhotos;
      for (const el of Array.from(photoForm.elements) as HTMLInputElement[]) if (el.type !== undefined) el.disabled = !me.canPostPhotos;
    }
  }

  function handleError(r: { status: number; data: any }) {
    if (r.status === 401) {
      me = null;
      applyMe();
      say('Please sign in first.');
    } else if (r.status === 428) {
      profileNeeded.hidden = false;
      say(r.data?.message || 'Please finish your profile first.');
    } else say(r.data?.message || 'Something went wrong. Please try again.');
  }

  commentForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(commentForm);
    const text = String(data.get('text') || '').trim();
    if (text.length < 2) {
      say('Please write something first.');
      return;
    }
    const btn = q<HTMLButtonElement>(commentForm, 'button[type=submit]')!;
    const r = await busy(btn, 'Sending…', () => api('/api/comments', { method: 'POST', body: JSON.stringify({ key, kind: data.get('kind'), text, ...(date ? { date } : {}) }) }));
    if (r.status === 200 || r.status === 422) {
      say(r.data.message);
      if (r.status === 200) commentForm.reset();
      if (r.data.status === 'published') await load(true);
    } else handleError(r);
  });

  if (photoForm && preview) {
    const fileInput = q<HTMLInputElement>(photoForm, 'input[type=file]')!;
    // Preview by drawing the picked photo on a canvas (no object URLs; the file is never put in the page as markup or a link).
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files?.[0];
      preview.hidden = true;
      if (!f || !/^image\/(jpeg|png|webp)$/.test(f.type) || !('createImageBitmap' in window)) return;
      try {
        const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
        const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
        preview.width = Math.max(1, Math.round(bmp.width * scale));
        preview.height = Math.max(1, Math.round(bmp.height * scale));
        preview.getContext('2d')!.drawImage(bmp, 0, 0, preview.width, preview.height);
        bmp.close();
        preview.hidden = false;
      } catch {
        preview.hidden = true;
      }
    });
    photoForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = fileInput.files?.[0];
      if (!f) {
        say('Please choose a photo.');
        return;
      }
      const data = new FormData(photoForm);
      if (!data.get('own') || !data.get('people') || !data.get('noKids')) {
        say('Please tick all three boxes to confirm the photo follows our rules.');
        return;
      }
      if (String(data.get('alt') || '').trim().length < 5) {
        say('Please describe the photo in a few words.');
        return;
      }
      const btn = q<HTMLButtonElement>(photoForm, 'button[type=submit]')!;
      const r = await busy(btn, 'Uploading… (this can take a few seconds)', async () => {
        const small = await shrink(f);
        data.set('file', small, 'photo.jpg');
        data.set('key', key);
        if (date) data.set('date', date);
        return api('/api/photos', { method: 'POST', body: data });
      });
      if (r.status === 200 || r.status === 422) {
        say(r.data.message);
        if (r.status === 200) {
          photoForm.reset();
          preview.hidden = true;
        }
      } else handleError(r);
    });
  }

  reportForm.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (!reportTarget) return;
    const data = new FormData(reportForm);
    reportDialog.close();
    const r = await api('/api/flags', { method: 'POST', body: JSON.stringify({ key, ...reportTarget, reason: data.get('reason'), note: data.get('note') || '' }) });
    if (r.status === 200) {
      say(r.data.message || 'Thanks for telling us.');
      await load(true);
    } else handleError(r);
  });
  q<HTMLButtonElement>(reportDialog, '[data-report-cancel]')!.addEventListener('click', () => reportDialog.close());

  (async () => {
    await load();
    if (!(await signedIn())) {
      applyMe();
      return;
    }
    const meRes = await api('/api/me');
    me = meRes.status === 200 && meRes.data?.signedIn ? (meRes.data.user as Me) : null;
    applyMe();
  })();
}
