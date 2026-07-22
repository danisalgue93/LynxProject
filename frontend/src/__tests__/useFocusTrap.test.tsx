import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { useFocusTrap } from '@/src/hooks/useFocusTrap';

function Dialog({ onClose }: { onClose: () => void }) {
  const ref = useFocusTrap<HTMLDivElement>(true, onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label="test dialog" tabIndex={-1}>
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

afterEach(cleanup);

describe('useFocusTrap', () => {
  it('exposes the dialog with modal semantics and moves focus inside on open', () => {
    render(<Dialog onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // First focusable child receives focus on mount.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks body scroll while open and restores it on unmount', () => {
    const { unmount } = render(<Dialog onClose={() => {}} />);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });

  it('wraps focus from the last element back to the first on Tab', () => {
    render(<Dialog onClose={() => {}} />);
    const last = screen.getByRole('button', { name: 'last' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'first' }));
  });
});
