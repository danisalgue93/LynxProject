# Devnet deployment — 2026-07-20

The Lynx program is deployed and bootstrapped on **devnet**. Smoke-tested
end-to-end (create_market + buy_position_sol with the slippage arg accepted;
market decoded correctly).

## On-chain addresses

| Item | Address |
|------|---------|
| **Program Id** | `CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu` |
| ProgramData | `HhKtdCB47jUEmZsRRPhZVSjdMFKXG2p6k4QGVoDf8v3m` |
| **Upgrade authority** | `GYMUuhZ4HiDrshzCE6YjVL6xE1W5CDDqpxaKa7auzSwW` (deployer) |
| ProtocolConfig (PDA `config`) | `6YCxuiHvs2deL4hKga22y7ZTXvAy4Fwjj8rYTf8ycQfh` |
| **admin** (config.admin) | `GYMUuhZ4HiDrshzCE6YjVL6xE1W5CDDqpxaKa7auzSwW` (deployer) |
| **treasury** | `GYMUuhZ4HiDrshzCE6YjVL6xE1W5CDDqpxaKa7auzSwW` (deployer, devnet) |
| LYNX mint | `6igDBKaWX42nYcVzGfrXaHC4vy11xk2hj4DzfqJckZjK` |
| stakeVault | `2vAi7PMiTVFBxzrU8NPVYTXeewMAs4rHrTaZHPcspaTv` |
| rewardsVault (PDA) | `EZzxB4z1rzPGr92oHD8aMRWA8MmL4UyqYSsyQjfRVRWB` |
| supplyTwap (PDA) | `3eJ8kP7jEd4DL6XJaJwonqyNFUfGb1w4yXCcRc8VLGtV` |

> ⚠️ **El admin on-chain es el deployer `GYMUuhZ4…`, NO tu Phantom `9Jga2n3B…`.**
> Para probar acciones de admin (crear mercado, proponer DAO) desde el frontend
> con tu Phantom, hay que `transfer_admin` a `9Jga2n3B…` primero (o multisig).
> Las acciones de usuario (comprar, stakear, aceptar duelo, votar) sí van con
> cualquier wallet con SOL de devnet.

## Config del frontend (`frontend/.env` o vars de shell)

```
VITE_PROGRAM_ID=CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu
VITE_SOLANA_NETWORK=devnet
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_TREASURY_WALLET=GYMUuhZ4HiDrshzCE6YjVL6xE1W5CDDqpxaKa7auzSwW
VITE_LYNX_MINT=6igDBKaWX42nYcVzGfrXaHC4vy11xk2hj4DzfqJckZjK
VITE_API_URL=http://localhost:4000
```
(`scripts/dev_stack.sh` ya exporta PROGRAM_ID + red devnet.)

## Config del backend (indexador/keeper)

```
PROGRAM_ID=CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu
SOLANA_RPC_URL=https://api.devnet.solana.com
LYNX_MINT=6igDBKaWX42nYcVzGfrXaHC4vy11xk2hj4DzfqJckZjK
TREASURY_WALLET=GYMUuhZ4HiDrshzCE6YjVL6xE1W5CDDqpxaKa7auzSwW
STORE_DRIVER=memory
# Para auto-liquidar duelos/DAO y ejecutar órdenes límite, dale al keeper una
# keypair bs58 con algo de SOL de devnet (puede ser una nueva):
# KEEPER_KEYPAIR_BS58=<bs58 secret key>
```

## Notas de bootstrap (pendientes, del propio script)

1. **init_multisig** con los 2 pubkeys de admin (threshold 2). Hasta entonces
   `transfer_admin` funciona desde la única clave (el deployer).
2. **TWAP keeper** ~24h antes de resolver cualquier mercado con valor real
   (`node scripts/twap_keeper.cjs`): una ventana vacía cae al supply instantáneo,
   que es manipulable (SC-01).
3. Por cada mercado **LYNX**: `init_market_lynx_vault` justo tras `create_market`,
   o nadie puede comprar en él (los mercados SOL no lo necesitan).

## Smoke test ejecutado (deployer = admin)

- `initialize_protocol` + `init_supply_twap` — OK.
- `create_market` (SOL, binario) — OK → market `6RHig9L4Fgxq6tYkgtoF7SVk9ACVXhGLqrNytdYXfWpQ` (mercado de prueba, ignorar).
- `buy_position_sol` (Yes, 0.1 SOL, `max_price_bps=10000`) — OK, pool = 0.1 SOL.
