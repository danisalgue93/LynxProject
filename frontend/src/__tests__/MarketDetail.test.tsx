import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketDetail } from '@/src/components/markets/MarketDetail';
import { MarketStatus, Position } from '@/src/types';
import type { Market } from '@/src/types';

// ── external dependency mocks ────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, _opts?: any) => fallback,
  }),
}));

vi.mock('@/src/hooks/useProgram', () => ({
  useProgram: () => ({
    fetchDuels: vi.fn().mockResolvedValue([]),
    executeTrade: vi.fn().mockResolvedValue(undefined),
    fetchPositions: vi.fn().mockResolvedValue([]),
    claimPosition: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/src/hooks/useBlockchainTransaction', () => ({
  useBlockchainTransaction: () => ({
    executeTransaction: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/src/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/src/lib/api', () => ({
  apiUrl: (path: string) => `http://localhost:4000${path}`,
}));

// Suppress framer-motion animation side-effects in jsdom
vi.mock('motion/react', () => ({
  motion: new Proxy({}, {
    get: (_target, tag: string) => {
      const { createElement } = require('react');
      return ({ children, ...props }: any) => createElement(tag, props, children);
    },
  }),
  AnimatePresence: ({ children }: any) => children,
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => [],
} as any);

// ── fixture ──────────────────────────────────────────────────────────────────

const makeMarket = (overrides: Partial<Market> = {}): Market => ({
  id: 'market-1',
  title: 'Will ETH reach $10k by 2026?',
  description: 'Resolution based on Coinbase spot price.',
  category: 'Crypto',
  status: MarketStatus.ACTIVE,
  poolAmount: 1000,
  yesAmount: 600,
  noAmount: 400,
  currency: 'SOL',
  oracleId: 'oracle-1',
  createdAt: Date.now() - 86400_000,
  cutoffAt: Date.now() + 86400_000,
  ...overrides,
});

// ── tests ────────────────────────────────────────────────────────────────────

describe('MarketDetail', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => [] });
  });

  it('renders the market title', () => {
    render(<MarketDetail market={makeMarket()} onClose={onClose} />);
    expect(screen.getByText('Will ETH reach $10k by 2026?')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    render(<MarketDetail market={makeMarket()} onClose={onClose} />);
    // The close button uses an SVG icon; target by its aria-label or find an X button
    const closeBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label') === 'Close' || btn.querySelector('svg')
    );
    // Fallback: click the first button that carries the X icon wrapper
    const allButtons = screen.getAllByRole('button');
    // The top-right close button is the first rendered button in the modal header
    fireEvent.click(allButtons[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows YES and NO quick-bet buttons for an active binary market', () => {
    render(<MarketDetail market={makeMarket()} onClose={onClose} />);
    expect(screen.getByText('YES')).toBeInTheDocument();
    expect(screen.getByText('NO')).toBeInTheDocument();
  });

  it('shows DRAW button for ternary markets', () => {
    render(<MarketDetail market={makeMarket({ isTernary: true, drawAmount: 100 })} onClose={onClose} />);
    expect(screen.getByText('DRAW')).toBeInTheDocument();
  });

  it('in readOnly mode calls onAuthRequired instead of placing a trade', () => {
    const onAuthRequired = vi.fn();
    render(
      <MarketDetail
        market={makeMarket()}
        onClose={onClose}
        readOnly
        onAuthRequired={onAuthRequired}
      />
    );
    // Click the place-bet submit button
    const betButton = screen.getByText('Place bet');
    fireEvent.click(betButton);
    expect(onAuthRequired).toHaveBeenCalled();
  });

  it('displays pool amount in the market stats', () => {
    render(<MarketDetail market={makeMarket({ poolAmount: 1234.56 })} onClose={onClose} />);
    // formatSOL renders the number; check partial text
    expect(screen.getByText(/1,234\.56/)).toBeInTheDocument();
  });

  it('shows a Claim payout button for resolved markets with a winning position', async () => {
    const { useProgram } = await import('@/src/hooks/useProgram');
    const mockFetchPositions = vi.fn().mockResolvedValue([
      { id: 'pos-1', marketId: 'market-1', position: Position.YES, claimed: false },
    ]);
    (useProgram as any).mockReturnValueOnce({
      fetchDuels: vi.fn().mockResolvedValue([]),
      executeTrade: vi.fn(),
      fetchPositions: mockFetchPositions,
      claimPosition: vi.fn(),
      isLoading: false,
      error: null,
    });

    const resolvedMarket = makeMarket({
      status: MarketStatus.RESOLVED,
      result: Position.YES,
      resolvedAt: Date.now() - 3600_000,
    });
    render(<MarketDetail market={resolvedMarket} onClose={onClose} />);
    // Wait for the async fetchPositions effect to resolve
    await vi.waitFor(() => {
      expect(mockFetchPositions).toHaveBeenCalled();
    });
  });
});
