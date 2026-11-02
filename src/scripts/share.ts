/** Share controls: preview dialog, the phone's share menu (Web Share API) and clipboard copy. */
import { toast } from './toast';
import { track } from './analytics';
import { blurbWithoutUrl } from '../lib/share';

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
    url: root.dataset.shareUrl ?? location.href,
    blurb: root.dataset.shareBlurb ?? '',
    key: root.dataset.shareKey ?? '',
    location: root.dataset.trackLocation ?? 'event',
  };
}

const keyProps = (key: string) => (key.startsWith('event:') ? {} : { entity: key });

async function nativeShare(root: HTMLElement): Promise<'shared' | 'cancelled' | 'unsupported'> {
  const d = data(root);
  const payload = { title: d.title, text: blurbWithoutUrl(d.blurb, d.url), url: d.url };
  if (!navigator.share || (navigator.canShare && !navigator.canShare(payload))) return 'unsupported';
  try {
    await navigator.share(payload);
    track('share', { method: 'native', location: d.location, ...keyProps(d.key) });
    return 'shared';
  } catch {
    return 'cancelled';
  }
}

document.querySelectorAll<HTMLElement>('[data-share]').forEach((root) => {
  const d = data(root);
  const canShare = typeof navigator.share === 'function';

  root.querySelectorAll<HTMLButtonElement>('[data-share-native]').forEach((btn) => {
    if (!canShare) return;
    btn.hidden = false;
    btn.addEventListener('click', () => void nativeShare(root));
  });

  // The Share button always opens the preview first, so people see the picture and text before they share.
  root.querySelectorAll<HTMLButtonElement>('[data-share-open]').forEach((btn) => {
    const dialog = document.getElementById(btn.dataset.shareOpen!) as HTMLDialogElement | null;
    btn.addEventListener('click', () => {
      if (!dialog?.showModal) {
        void nativeShare(root);
        return;
      }
      dialog.showModal();
      track('share_open', { location: d.location, ...keyProps(d.key) });
    });
    dialog?.querySelector('[data-dialog-close]')?.addEventListener('click', () => dialog.close());
    dialog?.addEventListener('click', (e) => {
      if (e.target === dialog) dialog.close();
    });
    dialog?.addEventListener('close', () => btn.focus());
  });

  root.querySelectorAll<HTMLButtonElement>('[data-share-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const link = btn.dataset.shareAction === 'copy-link';
      const ok = await copy(link ? d.url : d.blurb);
      toast(ok ? (link ? 'Link copied.' : 'Text copied. Paste it anywhere.') : 'Sorry, copying did not work. Please copy the link from the address bar.');
      track(ok ? 'share' : 'copy_failed', { method: link ? 'copy_link' : 'copy_text', location: d.location, ...keyProps(d.key) });
    });
  });

  // Page headers are dark and set their own colors; move dialogs (already wired up) so they use the page's normal colors.
  root.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => document.body.appendChild(dialog));
});
