# Lynx Protocol - Guia cripto

La carpeta `cripto` contiene el programa Anchor/Solana para la parte on-chain de Lynx.

## Estado actual

- `cargo check -p lynx_project` pasa.
- `anchor build --no-idl` pasa y genera el binario SBF.
- `anchor build` completo queda bloqueado solo en generacion IDL por una incompatibilidad entre `anchor-syn 0.30.1`, `proc_macro2` y Rust 1.89.
- `scripts/init_protocol.cjs` inicializa Devnet sin depender del IDL.

## Programa

Program ID:

```text
CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu
```

## Flujo economico implementado

1. `initialize_protocol`: registra admin, treasury, mint LYNX, vault de staking y vault de rewards.
2. `create_market`: crea mercados SOL o LYNX con autoridad de oraculo y fallback admin.
3. `buy_position_sol`: deposita SOL en el vault del mercado.
4. `buy_position_lynx_with_burn`: registra posicion LYNX y quema el 15% del importe apostado.
5. `cut_off_market`: cierra apuestas al llegar `cutoff_ts`.
6. `resolve_market_oracle`: resuelve con la signer de oraculo configurada.
7. `resolve_market_admin`: fallback del admin tras `oracle_deadline`.
8. `claim_market_sol`: paga a ganadores el 90% neto del pool SOL.
9. `mint_lynx_distribution`: emite LYNX tras eventos SOL: 20% participantes, 20% treasury, 60% venta inicial.
10. `stake_lynx`, `unstake_lynx`, `claim_staking_rewards`: staking LYNX con rewards SOL acumuladas por fee de eventos.
11. `create_duel`, `accept_duel`, `resolve_duel_sol`: duelos 1v1 SOL.
12. `resolve_protocol_duel`: flujo 1v1vP; si gana el protocolo, el SOL va a treasury; si gana el usuario, recupera stake y recibe LYNX emitido.

## Backend vs on-chain

El order book completo queda off-chain en `backend`, estilo Polymarket. El contrato mantiene las piezas que deben vivir on-chain: vaults, resolucion, emision/burn de LYNX, staking y duelos base.

## Deploy Devnet

```bash
npm run build:program
anchor deploy --provider.cluster devnet
npm run init:devnet
```

En Windows tambien puedes ejecutar `deploy_devnet.ps1`, que hace build, deploy e inicializacion.

## Panel admin

`admin-panel` se ha actualizado al layout nuevo:

- `ProtocolConfig`: admin, treasury, mint, stake vault, rewards vault.
- `Market`: incluye `is_ternary`, `draw_total` y `burned_lynx`.
- `resolve_market_admin` firma con las cuentas nuevas: config, market, vault, rewards vault, admin y treasury.
