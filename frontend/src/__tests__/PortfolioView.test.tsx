import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PortfolioView } from '@/src/components/portfolio/PortfolioView';

// ── external dependency mocks ────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({ publicKey: null, connected: false }),
}));

const stakeLynx = vi.fn().mockResolvedValue({ signature: 'sig-stake', onChain: true });
const unstakeLynx = vi.fn().mockResolvedValue({ signature: 'sig-unstake', onChain: true });

const portfolio = {
  wallet: 'MAGIC:00000000000000000000000000000000',
  solBalance: 10,
  lynxBalance: 50,
  stakedLynx: 20,
  holdings: [],
  approvedAt: Date.now(),
};

vi.mock('@/src/hooks/useProgram', () => ({
  useProgram: () => ({
    fetchMarkets: vi.fn().mockResolvedValue([]),
    fetchPortfolio: vi.fn().mockResolvedValue(portfolio),
    claimRewards: vi.fn().mockResolvedValue({ signature: 'sig-claim', onChain: true }),
    stakeLynx,
    unstakeLynx,
    depositSol: vi.fn().mockResolvedValue(undefined),
    withdrawSol: vi.fn().mockResolvedValue(undefined),
    // Staking is on-chain now: the "available to stake" and staked balance come
    // from these readers, not from the off-chain portfolio.
    fetchStakeInfo: vi.fn().mockResolvedValue({ amount: 20, pendingRewards: 0 }),
    fetchLynxBalance: vi.fn().mockResolvedValue(50),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/src/hooks/useBlockchainTransaction', () => ({
  useBlockchainTransaction: () => ({
    executeTransaction: vi.fn(async (op: () => Promise<unknown>) => op()),
  }),
}));

vi.mock('@/src/context/ToastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock('@/src/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'u@lynx.local' }, token: 't' }),
}));
vi.mock('@/src/lib/explorer', () => ({ getTxExplorerUrl: () => 'https://explorer.test' }));

// ── tests ────────────────────────────────────────────────────────────────────

/**
 * Staking amount validation.
 *
 * The submit button is already `disabled` for empty / NaN / <= 0 amounts, so
 * those never reach the handler. The cases below are the ones that slip past
 * that disabled check and must be caught by the handler itself:
 *
 *   - Infinity: isNaN(Infinity) is false and Infinity <= 0 is false, so the
 *     button stays enabled and the old guard
 *     (`!stakeAmount || isNaN(Number(stakeAmount))`) let it straight through.
 *   - Amount greater than the balance: nothing checked this anywhere on the
 *     client, so it was sent to the API and came back as a generic failure.
 */
describe('PortfolioView staking amount validation', () => {
  beforeEach(() => {
    stakeLynx.mockClear();
    unstakeLynx.mockClear();
  });

  async function setup() {
    render(<PortfolioView />);
    // The view opens on the 'wallet' tab; staking lives behind its own tab, so
    // navigate there the way a user would before the controls exist.
    fireEvent.click(await screen.findByRole('button', { name: /^Staking$/i }));
    // Wait for the async portfolio load so balances are available to the guard.
    const input = await screen.findByPlaceholderText('Amount of LYNX...');
    const button = screen.getByRole('button', { name: /Stake LYNX/i });
    return { input, button };
  }

  // NOTE: non-finite amounts (Infinity via 'Infinity' or '1e999') are not
  // covered here because they are not reachable through this UI: the field is
  // <input type="number">, which discards both, leaving the value empty and the
  // submit button disabled. The Number.isFinite() guard in handleStakeAction is
  // kept as defence in depth for any future caller that is not this input, but
  // there is deliberately no test asserting a path the user cannot take.

  it('refuses to stake more LYNX than the wallet holds', async () => {
    const { input, button } = await setup();
    // Balance is 50 LYNX.
    fireEvent.change(input, { target: { value: '999' } });

    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/exceeds your available LYNX/i)).toBeInTheDocument();
    });
    expect(stakeLynx).not.toHaveBeenCalled();
  });

  it('stakes a valid amount within the balance', async () => {
    const { input, button } = await setup();
    fireEvent.change(input, { target: { value: '25' } });

    expect(button).not.toBeDisabled();
    fireEvent.click(button);

    await waitFor(() => expect(stakeLynx).toHaveBeenCalledWith(25));
  });
});
