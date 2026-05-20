# LYNX PROTOCOL — Documentación técnica completa

## Arquitectura del sistema

```
                        ┌─────────────────────────────────────┐
                        │         EVENTO / PARTIDO             │
                        └──────────────────┬──────────────────┘
                                           │
                        ┌──────────────────▼──────────────────┐
                        │      Switchboard Feed (on-chain)     │
                        │  Lee resultado → llama oracle_resolve│
                        └──────────┬──────────────────────────┘
                                   │ Si no resuelve en 1 hora
                        ┌──────────▼──────────────────────────┐
                        │    Admin Panel (localhost + tunnel)  │
                        │    Password → Telegram OTP → Firma   │
                        └──────────┬──────────────────────────┘
                                   │
                        ┌──────────▼──────────────────────────┐
                        │       resolve_market_admin()         │
                        │  (solo disponible tras oracle_deadline)│
                        └──────────┬──────────────────────────┘
                                   │
                   ┌───────────────▼────────────────────┐
                   │         MINT $LYNX                  │
                   │   35% → holders del evento          │
                   │   50% → liquidity vault             │
                   │   15% → treasury                    │
                   └───────────────┬────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        Holder reclama      Liquidity pool        Treasury
        SOL ganado +        (DEX / AMM)           (gobernanza)
        $LYNX minteado      $LYNX circula
              │
              ▼
        SINKS (burn en torneos, fees P2P, duelos)
              │
              ▼
        Nuevo evento → nuevo mint → recirculación
```

---

## Flujo de un mercado paso a paso

| Paso | Instrucción | Quién | Cuándo |
|------|-------------|-------|--------|
| 1 | `create_market` | Admin | Al crear el evento |
| 2 | `buy_position` | Usuarios | Hasta `cutoff_ts` |
| 3 | `cut_off_market` | Cualquiera | Tras `cutoff_ts` |
| 4a | `resolve_market_oracle` | Cualquiera | Cuando el feed Switchboard tiene resultado |
| 4b | `resolve_market_admin` | Admin | Solo si pasó `oracle_deadline` (cutoff + 1h) |
| 5 | `mint_lynx_distribution` | Ganadores | Tras resolver |
| 6 | `claim_market` | Ganadores | Tras resolver (recibe SOL) |

---

## Setup del contrato

### 1. Prerrequisitos
```bash
# Instalar Anchor
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --locked

# Verificar versiones
anchor --version   # 0.29.0+
solana --version   # 1.18+
```

### 2. Dependencias en Cargo.toml
```toml
[dependencies]
anchor-lang = { version = "0.29.0", features = ["init-if-needed"] }
anchor-spl = "0.29.0"
switchboard-solana = "0.28"
```

### 3. Build y deploy
```bash
anchor build
anchor deploy --provider.cluster mainnet-beta
```

---

## Setup del oráculo Switchboard

### Opción A: Usar un feed existente (más simple)
Switchboard tiene feeds para precios de activos. Para eventos deportivos
necesitarás la Opción B.

### Opción B: Crear tu propio feed (para eventos)
```bash
# Instalar Switchboard CLI
npm install -g @switchboard-xyz/cli

# Crear un feed que lea de tu API de resultados
sb solana aggregator create mainnet-beta \
  --keypair ~/.config/solana/id.json \
  --name "Lynx Event Feed" \
  --batchSize 3 \
  --minRequiredOracleResults 2 \
  --minRequiredJobResults 1 \
  --minUpdateDelaySeconds 30 \
  --job ./jobs/event-result.json
```

### Formato del job JSON para Switchboard
```json
{
  "tasks": [
    {
      "httpTask": {
        "url": "https://api.tu-proveedor-deportivo.com/results/match_id"
      }
    },
    {
      "jsonParseTask": {
        "path": "$.result.winner"
      }
    },
    {
      "valueTask": {
        "big": "1.0"
      }
    }
  ]
}
```

**Convención de resultado:**
- Feed retorna `1.0` → YES gana
- Feed retorna `0.0` → NO gana  
- Feed retorna `0.5` → Empate

El programa lee este valor en `resolve_market_oracle()` y lo convierte al enum `Outcome`.

### Almacenar el feed address en el mercado
Al crear el mercado, pasa el `oracle_feed` pubkey del feed Switchboard.
El programa verifica on-chain que el feed pasado en `resolve_market_oracle`
coincide con el registrado en el mercado.

---

## Setup del panel de admin

### 1. Instalar
```bash
cd admin-panel
npm install next react react-dom iron-session @coral-xyz/anchor @solana/web3.js bs58
npm install -D typescript @types/react @types/node
```

### 2. Configurar el bot de Telegram (5 minutos)
1. Abre Telegram → busca `@BotFather`
2. Escribe `/newbot` → sigue las instrucciones
3. Copia el token que te da (formato: `123456789:AAxxxx`)
4. Escribe `/start` a `@userinfobot` → copia tu Chat ID
5. Pega ambos en `.env.local`

### 3. Correr localmente
```bash
cp .env.example .env.local
# Edita .env.local con tus valores reales
npm run dev
# Panel disponible en: http://localhost:3000/admin
```

### 4. Acceso remoto seguro (sin dominio público)

**Opción A: Cloudflare Tunnel (recomendada)**
```bash
# Instalar cloudflared
brew install cloudflare/cloudflare/cloudflared
# O: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/

# Crear un túnel temporal (URL aleatoria, solo cuando esté activo)
cloudflared tunnel --url http://localhost:3000

# Te da una URL tipo: https://random-words-here.trycloudflare.com
# Esta URL SOLO funciona mientras tengas el proceso corriendo
# Nadie puede encontrarla si no la conoce
```

**Opción B: Tailscale (más privado)**
```bash
# Instala Tailscale en tu máquina y tu móvil
# Solo los dispositivos en tu red Tailscale pueden acceder
# No hay URL pública en absoluto
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
# Accede desde tu móvil por la IP privada de Tailscale
```

**Mi recomendación:** Tailscale para máxima privacidad, Cloudflare Tunnel
para comodidad (puedes acceder desde cualquier navegador).

---

## Seguridad del panel

El sistema tiene 4 capas de protección:

1. **Red:** Solo accesible desde localhost o tu túnel privado
   - El middleware bloquea cualquier petición sin header `cf-ray` (Cloudflare) ni desde localhost
   
2. **Contraseña maestra:** Primer factor, almacenada solo en `.env.local`

3. **OTP Telegram:** Segundo factor, código de 6 dígitos, expira en 5 min
   - El bot es tuyo, nadie más tiene acceso
   - Si alguien tiene tu contraseña, aún necesita tu Telegram
   
4. **Sesión cifrada:** `iron-session` usa AES-256-CBC con tu `SESSION_SECRET`
   - Expira en 1 hora
   - `httpOnly`, `sameSite: strict` previenen ataques XSS/CSRF

5. **Keypair nunca sale del servidor:** El admin nunca envía su keypair al frontend.
   El `ADMIN_KEYPAIR_BS58` solo existe en `.env.local` del servidor.

6. **Constraint on-chain:** El contrato verifica que el admin solo puede resolver
   DESPUÉS de `oracle_deadline`. Aunque alguien comprometiera el panel,
   no podría resolver antes de que el oráculo tenga su oportunidad.

---

## Tokenomics $LYNX — Resumen

```
Al resolver un evento, el programa mintea:

  pool_total × LYNX_PER_LAMPORT tokens totales
  
  Distribuidos así:
  ├── 35% → holders ganadores del evento (proporcional a su posición)
  ├── 50% → liquidity vault (PDA del programa, para DEX/AMM)
  └── 15% → treasury (gobernanza, desarrollo)

Del pool de SOL apostado:
  ├── 85% → payout a ganadores (claim_market)
  └── 15% → fees del protocolo
        ├── 5% → founders treasury
        ├── 7.5% → dividendos holders
        └── 2.5% → infraestructura

Sinks (deflación):
  - Burn en torneos (burn_lynx)
  - Fees de trades P2P (van a infra_treasury, no se burnan)
```

---

## Correcciones aplicadas respecto a la versión anterior

| Bug | Corrección |
|-----|-----------|
| `cut_off_market` sin firma de admin | Sigue siendo permissionless (correcto — cualquiera puede activarlo tras cutoff_ts) pero ahora valida seeds del mercado |
| `place_order` sin escrow | Se añade `order_escrow` PDA que guarda los lamports |
| `take_order` permite auto-trade | `require_keys_neq!(taker, owner)` |
| Empate en duelo confisca el 100% | Documentado; en producción implementar devolución doble |
| `mint_lynx` — balance interno falso | Reemplazado por SPL Token real con mint authority en el PDA config |
| `transfer_from_program_vault` con `.unwrap()` | Eliminado, ahora usa `?` y error tipado |
| Zeroing manual de cuenta Order | Usa `close = owner` en el contexto Anchor |
| No había timeout del oráculo | Añadido `oracle_deadline` y `resolve_market_admin` con guard temporal |
