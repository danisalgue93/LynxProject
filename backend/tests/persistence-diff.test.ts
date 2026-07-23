import { describe, it, expect } from 'vitest';
import { diffRows } from '../src/persistence.js';

/**
 * Regression for a silent data-loss bug in the incremental save path.
 *
 * diffRows() used to advance the "last written" snapshot WHILE computing the
 * diff — i.e. before persistence.save() had actually run its prisma
 * $transaction. If that transaction then failed (DB down, deadlock, dropped
 * connection), the rows had never been written, but the snapshot already
 * claimed they had. The next save() therefore saw no difference and never wrote
 * them again: balances, orders and ledger entries stayed in memory only and
 * vanished on the next restart.
 *
 * The snapshot must only advance when the caller explicitly commits, which
 * save() does after the transaction resolves.
 */
describe('diffRows: snapshot only advances on commit()', () => {
  it('does not mark rows as persisted until commit() is called', () => {
    const snapshot = new Map<string, string>();
    const rows = new Map([['w1', { wallet: 'w1', solBalance: 10 }]]);

    const first = diffRows(rows, snapshot);
    expect(first.changed).toHaveLength(1);
    // Simulate the DB transaction FAILING: commit() is never called.
    expect(snapshot.size, 'snapshot must be untouched before commit').toBe(0);

    // The retry must still see the row as pending, not silently skip it.
    const retry = diffRows(rows, snapshot);
    expect(retry.changed, 'a failed save must be retried, not dropped').toHaveLength(1);

    retry.commit();
    expect(snapshot.size).toBe(1);
  });

  it('skips unchanged rows once committed, and re-emits them when they change', () => {
    const snapshot = new Map<string, string>();
    const rows = new Map([['w1', { wallet: 'w1', solBalance: 10 }]]);

    diffRows(rows, snapshot).commit();
    expect(diffRows(rows, snapshot).changed, 'unchanged row must not be rewritten').toHaveLength(0);

    rows.set('w1', { wallet: 'w1', solBalance: 25 });
    const afterChange = diffRows(rows, snapshot);
    expect(afterChange.changed).toHaveLength(1);
    expect(afterChange.changed[0].solBalance).toBe(25);
  });

  it('reports deletions but only prunes the snapshot on commit()', () => {
    const snapshot = new Map<string, string>();
    const rows = new Map([['a', { id: 'a' }], ['b', { id: 'b' }]]);
    diffRows(rows, snapshot).commit();

    rows.delete('b');
    const withDeletion = diffRows(rows, snapshot);
    expect(withDeletion.deletedKeys).toEqual(['b']);
    // Transaction failed -> 'b' must still be queued for deletion next time.
    expect(snapshot.has('b')).toBe(true);
    expect(diffRows(rows, snapshot).deletedKeys).toEqual(['b']);

    diffRows(rows, snapshot).commit();
    expect(snapshot.has('b')).toBe(false);
  });

  it('leaves the new-vs-existing decision intact during the write phase', () => {
    // save() decides createMany vs upsert with `snapshot.has(id)` INSIDE the
    // transaction. Eagerly inserting ids made that always true, so the batch
    // insert fast path was dead code. The id must not appear until commit().
    const snapshot = new Map<string, string>();
    const rows = new Map([['t1', { id: 't1' }]]);
    const diff = diffRows(rows, snapshot);
    expect(snapshot.has('t1'), 'a brand-new row must look new during the write phase').toBe(false);
    diff.commit();
    expect(snapshot.has('t1')).toBe(true);
  });
});
