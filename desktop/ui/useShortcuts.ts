import { useEffect, type RefObject } from 'react';

export const macShortcuts = /Mac|iPhone|iPad/.test(navigator.platform);
export const shortcutLabel = (key: string) => `${macShortcuts ? '⌘' : 'Ctrl'} + ${key}`;
export const shortcutAria = (key: string) => `${macShortcuts ? 'Meta' : 'Control'}+${key}`;

export function useShortcuts({ search, frame, blocked, busy, loading, canPreview, refresh, selectSource, preview, settings }: {
  search: RefObject<HTMLInputElement | null>; frame: RefObject<HTMLIFrameElement | null>;
  blocked: boolean; busy: boolean; loading: boolean; canPreview: boolean;
  refresh(): void; selectSource(index: number): void; preview(): void; settings(): void;
}) {
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      const modifier = macShortcuts ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
      const key = event.key.toLowerCase();
      if (!modifier || event.altKey || event.shiftKey || !['f', 'r', 'p', ',', '1', '2', '3'].includes(key)) return;
      // Reserve our combinations even while unavailable: never reload or print the WebView.
      event.preventDefault();
      if (event.repeat || blocked || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (target && target !== search.current && target.getClientRects().length > 0 && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (key === 'f') { search.current?.focus(); search.current?.select(); return; }
      if (busy) return;
      if (key === 'r' && !loading) refresh();
      else if (/^[123]$/.test(key)) selectSource(Number(key) - 1);
      else if (key === 'p' && canPreview) preview();
      else if (key === ',') settings();
    };
    document.addEventListener('keydown', keydown);
    // Sandboxed same-origin preview has its own document; events do not bubble out.
    const iframe = frame.current;
    let previewDocument: Document | null = null;
    const attach = () => {
      previewDocument?.removeEventListener('keydown', keydown);
      previewDocument = iframe?.contentDocument || null;
      previewDocument?.addEventListener('keydown', keydown);
    };
    attach(); iframe?.addEventListener('load', attach);
    return () => {
      document.removeEventListener('keydown', keydown);
      iframe?.removeEventListener('load', attach);
      previewDocument?.removeEventListener('keydown', keydown);
    };
  });
}
