import { useEffect, useRef } from 'react';

/**
 * Accessibility primitive for modal dialogs. Attach the returned ref to the
 * dialog's container element and the hook will, while `isOpen` is true:
 *
 *  - move focus into the dialog on open (first focusable element, or the
 *    container itself) and RESTORE focus to whatever was focused before, on close;
 *  - trap Tab / Shift+Tab so focus cannot leave the dialog (WCAG 2.4.3 / 2.1.2);
 *  - close on Escape (WCAG 2.1.2 "no keyboard trap");
 *  - lock body scroll so the page behind the overlay doesn't scroll.
 *
 * This is deliberately a hook rather than a wrapper component so existing modals
 * can adopt it without restructuring their markup/animation — they only add the
 * ref plus role="dialog" aria-modal aria-labelledby.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function useFocusTrap<T extends HTMLElement = HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
): React.RefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  // Keep the latest onClose without re-running the effect (and re-trapping
  // focus) every render when the caller passes a fresh closure.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // All focusable descendants, minus ones explicitly hidden via the `hidden`
    // attribute. We intentionally do NOT filter on offsetParent/layout: dialog
    // focusables are visible in practice, and a layout-based check silently
    // returns nothing under jsdom (no layout engine), breaking the trap in tests.
    const focusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
      );

    // Move focus into the dialog. If it has no focusable child, focus the
    // container itself (needs tabindex=-1 on the element the ref is attached to).
    const first = focusables()[0];
    (first ?? container).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || active === container)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger so keyboard users aren't dumped at the top.
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  return containerRef;
}
