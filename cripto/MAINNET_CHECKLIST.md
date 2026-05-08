# Mainnet Checklist

No desplegar con fondos reales hasta completar esto.

## Contrato

- `anchor build` sin warnings criticos
- `anchor test` con local validator limpio
- pruebas para cada instruccion
- pruebas de permisos admin
- pruebas de overflow y cantidades cero
- pruebas de payout proporcional con redondeos
- pruebas de duelos con YES, NO y DRAW
- pruebas de cancelacion/expiracion
- pruebas de ordenes parciales
- pruebas de tesorerias y fees

## Seguridad

- multisig para admin
- timelock para resolucion manual
- Switchboard como oracle principal
- fallback manual solo tras delay
- freeze de trading al cut-off
- auditoria externa
- programa verificado/publicado

## Operacion

- RPC dedicado
- monitoreo de transacciones fallidas
- backups de llaves de despliegue
- runbook para pausar mercados nuevos si hay incidente
- politica publica de resolucion de eventos

## Frontend

- `.env.production` con RPC de produccion
- `npm run build`
- smoke test conectando wallet
- smoke test leyendo mercados on-chain
- smoke test enviando una transaccion en devnet antes de mainnet
