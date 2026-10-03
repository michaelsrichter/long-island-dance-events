/** Share controls: Web Share API, accessible dialog fallback and clipboard copy. */
import { toast } from './toast';
import { track } from './analytics';

async function copy(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to legacy path */
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

function data(root: HTMLElement) {
  return {
    title: root.dataset.shareTitle ?? document.title,
    text: root.dataset.shareText ?? '',
    url: root.dataset.shareUrl ?? location.href,
    details: root.dataset.shareDetails ?? '',
    slug: root.dataset.shareSlug ?? '',
    location: root.dataset.trackLocation ?? 'event',
  };
}

async function nativeShare(root: HTMLElement): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const d = data(root);
  const payload = { title: d.title, text: d.text.replace(d.url, '').trim(), url: d.url };
  if (!navigator.share || (navigator.canShare && !navigator.canShare(payload))) return 'unsupported';
  try {
    await navigator.share(payload);
    track('share', { method: 'native', event_slug: d.slug, location: d.location });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}

document.querySelectorAll<HTMLElement>('[data-share]').forEach((root) => {
  const d = data(root);

  // Inline variant: reveal the native share button only where supported.
  const nativeBtn = root.querySelector<HTMLButtonElement>('[data-share-native]');
  if (nativeBtn && typeof navigator.share === 'function') {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener('click', () => void nativeShare(root));
  }

  // Button variant: native share first, then the dialog.
  root.querySelectorAll<HTMLButtonElement>('[data-share-open]').forEach((btn) => {
    const dialog = document.getElementById(btn.dataset.shareOpen!) as HTMLDialogElement | null;
    btn.addEventListener('click', async () => {
      const result = await nativeShare(root);
      if (result !== 'unsupported') return;
      if (dialog?.showModal) {
        dialog.showModal();
        track('share_open', { event_slug: d.slug, location: d.location });
      }
    });
    dialog?.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close());
    dialog?.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog?.addEventListener('close', () => btn.focus());
  });

  root.querySelectorAll<HTMLButtonElement>('[data-share-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const kind = btn.dataset.shareAction;
      const text = kind === 'copy-link' ? d.url : d.details;
      const ok = await copy(text);
      toast(ok ? (kind === 'copy-link' ? 'Link copied.' : 'Event details copied. Paste them anywhere.') : 'Sorry, copying did not work. Please copy the link from the address bar.');
      track(ok ? 'share' : 'copy_failed', { method: kind === 'copy-link' ? 'copy_link' : 'copy_details', event_slug: d.slug, location: d.location });
    });
  });
});
