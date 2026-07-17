import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderBookView } from '@/src/components/orderbook/OrderBookView';
import { MarketStatus } from '@/src/types';

// ── external dependency mocks ────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({ publicKey: null, connected: false }),
}));

vi.mock('@/src/hooks/useProgram', () => ({
  useProgram: () => ({
    fetchMarkets: vi.fn().mockResolvedValue([
      {
        id: 'market-42',
        title: 'Will BTC hit $200k?',
        description: '',
        category: 'Crypto',
        status: MarketStatus.ACTIVE,
        poolAmount: 500,
        yesAmount: 300,
        noAmount: 200,
        currency: 'SOL',
        oracleId: 'oracle-1',
        createdAt: Date.now() - 86400_000,
        cutoffAt: Date.now() + 86400_000,
      },
    ]),
    executeTrade: vi.fn().mockResolvedValue(undefined),
    executeLynxOrder: vi.fn().mockResolvedValue(undefined),
    fetchOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [], trades: [] }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/src/context/ToastContext', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/src/lib/auth', () => ({
  getManagedWalletAddress: vi.fn().mockReturnValue(null),
  useManagedAuthSession: vi.fn().mockReturnValue(null),
}));

vi.mock('@/src/lib/eventBus', () => ({
  eventBus: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
}));

vi.mock('@/src/lib/api', () => ({
  apiUrl: (path: string) => `http://localhost:4000${path}`,
}));

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => [],
} as any);

// ── tests ────────────────────────────────────────────────────────────────────

describe('OrderBookView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (global.fetch as any).mockResolvedValue({ ok: true, json: async () => [] });
  });

  it('renders without crashing', () => {
    const { container } = render(<OrderBookView />);
    expect(container).not.toBeEmptyDOMElement();
  });

  it('defaults to the LYNX/SOL market', () => {
    render(<OrderBookView />);
    // "LYNX / SOL" appears in several places (tab label, headings), so assert
    // presence rather than uniqueness. This test is about which market is
    // selected, not the exact marketing copy — which reads "LYNX / SOL Token".
    expect(screen.getAllByText(/LYNX \/ SOL/).length).toBeGreaterThan(0);
    // The LYNX/SOL side of the book is what drives the buy control.
    expect(screen.getByText('Buy LYNX')).toBeInTheDocument();
  });

  it('shows Buy and Sell side toggle buttons', () => {
    render(<OrderBookView />);
    expect(screen.getByText('Buy')).toBeInTheDocument();
    expect(screen.getByText('Sell')).toBeInTheDocument();
  });

  it('shows Limit and Market order type buttons', () => {
    render(<OrderBookView />);
    expect(screen.getByText('Limit')).toBeInTheDocument();
    expect(screen.getByText('Market')).toBeInTheDocument();
  });

  // These fields carry no placeholder — the visible "Price (SOL)" / "Qty (LYNX)"
  // hints are decorative sibling spans. They are now queried by accessible name,
  // which is both how a screen reader finds them and a stronger guarantee than a
  // placeholder: it fails if the inputs ever lose their label again.
  it('shows price and amount inputs for limit orders', () => {
    render(<OrderBookView />);
    expect(screen.getByLabelText('Price (SOL)')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount (LYNX)')).toBeInTheDocument();
  });

  it('hides price input when Market order type is selected', () => {
    render(<OrderBookView />);
    fireEvent.click(screen.getByText('Market'));
    expect(screen.queryByLabelText('Price (SOL)')).not.toBeInTheDocument();
  });

  it('switches to Sell side when Sell button is clicked', () => {
    render(<OrderBookView />);
    const sellBtn = screen.getByText('Sell');
    fireEvent.click(sellBtn);
    // The active sell styling is bg-red-400; asserting the exact shade is
    // brittle, so just require that the button took on a red active state.
    expect(sellBtn.closest('button')?.className).toMatch(/bg-red-/);
  });

  it('calls onAuthRequired when readOnly and a trade is attempted', () => {
    const onAuthRequired = vi.fn();
    render(<OrderBookView readOnly onAuthRequired={onAuthRequired} />);
    // On the default LYNX/SOL book the submit control reads 'Buy LYNX'
    // ('Submit' only appears for limit orders on prediction markets).
    fireEvent.click(screen.getByText('Buy LYNX'));
    expect(onAuthRequired).toHaveBeenCalled();
  });
});
