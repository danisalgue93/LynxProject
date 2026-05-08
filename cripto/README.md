# Lynx Protocol Anchor Program

Nucleo on-chain de Lynx Protocol.

Incluye:

- configuracion del protocolo y tesorerias
- mercados con vault PDA por evento
- compra de posiciones YES/NO con SOL bloqueado
- cut-off, snapshot contable de LYNX, resolucion y claim
- order book P2P basico con fee de trading
- duelos 1v1 derivados de un mercado padre

## Comandos

```bash
anchor build
anchor test
```

El programa usa el id `7hPfrAwhNPJ6Xt7Y3ximBog1EdzfJV31VBTnYQxLRYCy`, alineado con `Anchor.toml`.

## Antes de mainnet

Para produccion real con fondos hace falta compilar con Anchor, desplegar en el cluster objetivo, ejecutar pruebas de integracion, integrar oracle Switchboard, usar multisig/timelock para admin fallback y auditar el contrato.
