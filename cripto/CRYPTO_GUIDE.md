# Lynx Crypto Module — Complete Guide

## Architecture

```
cripto/
├── programs/lynx_project/   Anchor smart contract (Solana)
│   └── src/
│       ├── lib.rs           All instructions (entry points)
│       ├── state.rs         On-chain account structures
│       ├── constants.rs     Protocol constants (fees, BPS, limits)
│       └── error.rs         Custom error codes
├── admin-panel/             Next.js admin UI (market resolution)
├── scripts/init_protocol.cjs  One-time protocol initialization
├── migrations/deploy.ts     Anchor migration (alternative init)
└── Anchor.toml              Anchor workspace config
```

## Smart Contract Instructions

### Market lifecycle

| Instruction | Signer | Notes |
|-------------|--------|-------|
| `create_market` | Admin | Creates on-chain market with vault |
| `buy_position_sol` | Buyer | Permissionless — deposits SOL |
| `buy_position_lynx_with_burn` | Buyer | Burns 15% LYNX, deposits remainder |
| `cut_off_market` | Anyone | Permissionless once `cutoff_ts` is reached |
| `resolve_market_oracle` | Oracle authority | After `resolve_ts` |
| `resolve_market_admin` | Admin | After `oracle_deadline` (oracle fallback) |
| `claim_market_sol` | Winning position owner | After market is Resolved |
| `mint_lynx_distribution` | Position owner | Mints LYNX participation rewards |

### Staking

| Instruction | Notes |
|-------------|-------|
| `stake_lynx` | Deposit LYNX, start earning SOL rewards |
| `unstake_lynx` | Withdraw LYNX, claims pending SOL rewards |
| `claim_staking_rewards` | Claim accrued SOL rewards |

### Duels

| Instruction | Notes |
|-------------|-------|
| `create_duel` | Creator deposits SOL and picks outcome |
| `accept_duel` | Rival deposits equal SOL with opposite outcome |
| `resolve_duel_sol` | Permissionless once parent market is Resolved |
| `resolve_protocol_duel` | OneVOneVProtocol type only |

## Protocol Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `EVENT_PROTOCOL_FEE_BPS` | 1000 (10%) | Total fee deducted from winning pool |
| `STAKER_REWARD_FEE_BPS` | 500 (5%) | Portion going to LYNX stakers |
| `TREASURY_EVENT_FEE_BPS` | 500 (5%) | Portion going to treasury |
| `GLOBAL_TRADE_FEE_BPS` | 10 (0.1%) | Fee on duel payouts |
| `LYNX_EVENT_BURN_BPS` | 1500 (15%) | LYNX burned on market entry |
| `ORACLE_TIMEOUT_SECONDS` | 3600 | Grace period before admin can resolve |

## Deployment

### Prerequisites

- Rust + Solana CLI + Anchor CLI 0.30.1
- A funded Solana wallet at `~/.config/solana/id.json`

### Steps

```bash
# 1. Build and deploy the program
cd cripto
anchor build
anchor deploy --provider.cluster devnet

# 2. Initialize the protocol (creates config PDA, LYNX mint, vaults)
PROGRAM_ID=<deployed_program_id> node scripts/init_protocol.cjs

# 3. Note the output addresses:
#    - config PDA
#    - LYNX mint address
#    → Update VITE_PROGRAM_ID and VITE_LYNX_MINT in frontend .env
#    → Update PROGRAM_ID and LYNX_MINT in backend .env
```

## Security notes

- The admin keypair used for `resolve_market_admin` is stored only in the admin panel's environment variables, never in the frontend or backend.
- The oracle authority keypair (`oracle_authority`) is a separate key with narrower permissions — it can only resolve markets, not administer the protocol.
- All arithmetic uses `checked_*` operations to prevent overflow/underflow.
- All vault transfers verify rent-exemption before withdrawing.
