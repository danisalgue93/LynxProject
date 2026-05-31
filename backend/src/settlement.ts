/**
 * Settlement logic for market resolution
 * Handles payout calculations and fee distribution
 */

export interface SettlementInput {
  marketId: string;
  outcome: 'YES' | 'NO' | 'A' | 'B' | 'DRAW';
  totalPoolAmount: number;
  winnerPositions: Array<{ userId: string; amount: number }>;
  resolvedBy: string;
}

export interface SettlementResult {
  outcome: string;
  totalPool: number;
  winnerAmount: number;
  feeTotal: number;
  feeStaking: number;
  feeTreasury: number;
  distributions: Array<{
    userId: string;
    originalAmount: number;
    payout: number;
  }>;
}

const FEE_TOTAL_PERCENT = 0.10; // 10%
const FEE_STAKING_SHARE = 0.50; // 50% of total fees
const FEE_TREASURY_SHARE = 0.50; // 50% of total fees

/**
 * Calculate settlement payouts for a market
 * 
 * 1. Take total pool
 * 2. Deduct fees (10% total)
 * 3. Distribute to winners proportionally
 */
export function calculateSettlement(input: SettlementInput): SettlementResult {
  const { outcome, totalPoolAmount, winnerPositions } = input;

  // Calculate total fees
  const feeTotal = totalPoolAmount * FEE_TOTAL_PERCENT;
  const feeStaking = feeTotal * FEE_STAKING_SHARE;
  const feeTreasury = feeTotal * FEE_TREASURY_SHARE;

  // Amount available for winners after fees
  const amountForWinners = totalPoolAmount - feeTotal;

  // Sum of all winner positions
  const totalWinnerAmount = winnerPositions.reduce((sum, w) => sum + w.amount, 0);

  // Payout per unit of winning position
  const payoutPerUnit = totalWinnerAmount > 0 ? amountForWinners / totalWinnerAmount : 0;

  // Calculate individual payouts
  const distributions = winnerPositions.map((winner) => ({
    userId: winner.userId,
    originalAmount: winner.amount,
    payout: winner.amount * payoutPerUnit,
  }));

  return {
    outcome,
    totalPool: totalPoolAmount,
    winnerAmount: amountForWinners,
    feeTotal,
    feeStaking,
    feeTreasury,
    distributions,
  };
}

/**
 * Validate settlement before executing
 */
export function validateSettlement(
  outcome: string,
  positions: string[],
  totalPool: number
): { valid: boolean; error?: string } {
  if (!outcome) {
    return { valid: false, error: 'Outcome must be specified' };
  }

  if (!positions.includes(outcome)) {
    return { valid: false, error: `Outcome must be one of: ${positions.join(', ')}` };
  }

  if (totalPool <= 0) {
    return { valid: false, error: 'Total pool must be greater than 0' };
  }

  return { valid: true };
}
