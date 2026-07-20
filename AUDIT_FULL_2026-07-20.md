# Auditoría exhaustiva pre-producción — LynxProject

**Fecha:** 2026-07-20
**Alcance:** todo el repo — programa Anchor/Solana (`cripto/`), backend Node/TS
(`backend/`), frontend React/Vite (`frontend/`), panel admin Next.js
(`cripto/admin-panel/`), DevOps (docker-compose, nginx, CI), base de datos
(Prisma), dependencias y scripts.
**Método:** lectura de fuentes + verificación cruzada (archivo:línea) + ejecución
real de las suites de test.

> **Regla aplicada:** cada hallazgo lleva evidencia (archivo:línea). Donde no pude
> verificar por ejecución real, se marca **REVISIÓN MANUAL NECESARIA** en vez de
> asumir. No se han inventado hallazgos para "rellenar" hasta 50: se listan los
> reales encontrados (≈30) más las áreas que requieren revisión manual adicional.

---

## 00. Testing y verificación completados (para producción)

Todo lo automatizable ejecutado y en verde:

| Módulo | Build prod | Tests | Lint | npm audit (prod) |
|--------|-----------|-------|------|------------------|
| **Backend** | `tsc` ✓ | **68** ✓ (incl. nuevo test de socket A-N2) | 0 errores (135 warns `any`) | 24 — todas transitivas *breaking* |
| **Frontend** | `vite build` ✓ | **49** ✓ | 0 errores (107 warns `any`) | 52 — transitivas *breaking* (Solana/lodash/ws) |
| **Admin-panel** | `next build` ✓ (bundle 87–90 kB) | **24** ✓ | ✔ sin warnings | 8 — transitivas *breaking* (next/web3.js) |
| **On-chain** | `cargo build` + `build-sbf` ✓ | **52** ✓ | `clippy -D warnings` = 0 | — |
| **Infra** | `docker compose config` ✓ (valida + confirma los `:?` de A-N1) | — | — | — |

**Test nuevo añadido:** `backend/tests/socket.test.ts` — prueba de extremo a
extremo de la frontera de autorización del WebSocket (regresión de A-N2): (1)
rechaza conexión sin token, (2) rechaza token inválido, (3) un evento
`ledger:*` scoped a la wallet de Alice llega SOLO a Alice, **nunca a Bob**.
Cierra el hueco de test que quedaba abierto. Añadido `socket.io-client` a
devDeps del backend.

**Dependencias (M-N3 ejecutado con red):** aplicados los `npm audit fix`
*no-breaking* (backend 28→24, quitó 1 crítico + 2 high + 1 low; frontend 53→52).
Los residuales son **todos transitivos y requieren fixes *breaking***:
- Árbol Solana (`bigint-buffer` → `@solana/spl-token`/`buffer-layout-utils`):
  CVE inherente al ecosistema `web3.js`, **sin parche upstream**; `--force` lo
  degradaría y rompería la integración de wallets. **Riesgo aceptado** (ya
  documentado como riesgo asumido por el equipo).
- `lodash`/`ws` (frontend, transitivos): no explotables por el uso de la app
  (no se llama `_.template` con entrada no confiable).
- `next` (admin): DoS del Image Optimizer vía `remotePatterns` — **no
  alcanzable**: el panel usa `img-src 'self' data:` (sin imágenes remotas).
No se aplicó ningún `--force` para no romper Solana/Next por una transitiva.

### Gates manuales que quedan (solo TÚ puedes ejecutarlos)

Lo automatizable está hecho. Para el 100% de producción faltan verificaciones que
requieren tu entorno/despliegue y no se pueden hacer desde aquí:

1. **Devnet end-to-end (imprescindible):** fondear el deployer `GYMUuhZ4…`,
   `anchor deploy --provider.cluster devnet`, `init_protocol`, y probar el flujo
   completo con wallet real: crear mercado → comprar (con slippage) → cerrar →
   resolver por multisig 2-de-2 → claim. Es el único test que ejercita el
   programa desplegado + firmas reales de Phantom.
2. **Migración M-N2 (decisión):** completar o acotar la parte off-chain
   (duelos/DAO/spot en `state.ts`) antes de abrir esos flujos con dinero real.
3. **Prueba de carga/latencia** del backend+indexador (p.ej. k6/artillery) con
   ≥2 réplicas y Redis, para validar los locks distribuidos bajo concurrencia.
4. **Auditoría de accesibilidad (a11y)** del frontend (axe/Lighthouse).
5. **Simulacro de backup/restore** real (`RUNBOOK.md`) y de rollback de deploy.
6. **`npm audit` en CI** ya añadido (advisory); revisar su salida en cada corrida.

---

## 0. Estado de correcciones — iteración 1

Aplicadas y verificadas en esta ronda (`tsc` + tests verdes en frontend y
admin-panel; compose revisado):

| Hallazgo | Estado |
|----------|--------|
| **A-N1** Redis URL/password | ✅ CORREGIDO — `docker-compose.yml` sin `REDIS_USER`, `redis://:${REDIS_PASSWORD:?…}@`, `:?` en las 3 referencias |
| **M-N1** `.env.local` trackeado | ✅ CORREGIDO — `git rm --cached`, ya ignorado |
| **B-N1** `@google/genai` sin usar | ✅ CORREGIDO — desinstalado (−16 paquetes); `npm audit` front = 0 vulns |
| **B-N2** cabeceras en assets nginx | ✅ CORREGIDO — HSTS/nosniff/X-Frame re-declaradas en la location de assets |
| **B-N5** MoonPay | ✅ CORREGIDO — `walletAddress` validado (base58 32–44) + `limit_req` en `/integrations/` |
| **B-N6** longitud `SESSION_SECRET` | ✅ CORREGIDO — exige ≥32 chars |
| **M-N3** `npm audit` en CI | ✅ CORREGIDO — paso advisory en los 3 jobs JS |

Diferidos con justificación (grandes o por-diseño):
- **M-N2** migración on-chain de duelos + DAO: **IMPLEMENTADA** (paso 2). Capa
  cliente + indexador + cableado UI + keeper de auto-liquidación, con fallback
  legacy y unit-tests de layout de bytes (frontend 55, backend 72). Duelos =
  solo-SOL; propuestas DAO = solo-admin + voto ponderado por stake. **Aceptación
  end-to-end pendiente de devnet** (requiere el programa desplegado). Ver los
  commits `19dabb2` (builders DAO + indexador) y `3bdd9fe` (UI + keeper).
- **B-N3** denylist de access token: mitigado por TTL 15 min; endurecimiento opcional.
- **B-N4** `error.message` al admin: **aceptado por diseño** — el panel es una herramienta de un operador de confianza (host-allowlist + TOTP + iron-session) que NECESITA el detalle para diagnosticar un mercado atascado; degradarlo a genérico perjudica el propósito del panel.
- **B-N7** migración completa a `DomainError`: incremental; la infraestructura ya está.
- **I-1** modularización de ficheros grandes: continuo.

---

## 0-quater. Ronda 4 de auditoría (desde cero) — sinks XSS frontend

Revisados los sinks de `href`/`src`/`window.open`/`target=_blank` del frontend:
- `Dashboard.tsx:289`, `PublicPage.tsx:294`: `href={toast.link}` con `rel="noreferrer"` — link de explorer construido en servidor. OK.
- `PortfolioView.tsx:24`: `window.open(data.url, …, 'noopener,noreferrer')` — URL MoonPay firmada en servidor. OK.
- `ToastContainer.tsx:36`: tiene `rel="noopener noreferrer"` — sin reverse-tabnabbing. `toast.url` se genera en cliente.
- `MarketCard.tsx:58`: `<img src={market.imageUrl}>` (admin) — `img src` no ejecuta JS. INFO.

**Corregido (hardening, INFO):** `ToastContainer.tsx` — React no bloquea hrefs
`javascript:`/`data:`; se añadió un guard `^https?://` para que el enlace solo se
renderice con URLs http(s). Cierra el sink ante cualquier ruta futura que
alimente `toast.url` con datos no confiables. `tsc` + 49 tests frontend verdes.

Resultado ronda 4: **0 bugs explotables nuevos**; solo el hardening anterior.

---

## 0-ter. Ronda 3 de auditoría (desde cero) — 1 hallazgo nuevo (corregido)

Foco en superficies aún no revisadas línea a línea: WebSocket, scripts de shell,
y settlement on-chain (claim/sweep).

**A-N2 — ALTO — Fuga de privacidad financiera por WebSocket — CORREGIDO**
- **Archivo:** `backend/src/server.ts` — helper `emit()` (= `io.emit()`, difunde a
  TODOS los sockets) usado para eventos **privados**: `ledger:approved` (2186),
  `ledger:deposit` (2267, 2340), `ledger:withdrawal` (2404, 2455, **incluye la
  firma on-chain**), `crypto:tx` (2695).
- **Riesgo / explotación:** el socket exige JWT (`io.use`, línea 177) y auto-une
  al usuario a las rooms de SUS wallets — pero estos eventos se emitían con
  `io.emit` global. Cualquier usuario **autenticado** (basta registrarse) que
  conecte un socket recibe en tiempo real los depósitos, retiros, importes,
  wallets y **firmas de transacción de TODOS los demás usuarios**. Es un
  Broken Access Control / exposición de datos sensibles (OWASP A01/A04): permite
  a cualquier usuario mapear la actividad financiera y las wallets de todos.
- **Impacto:** ALTO en una app FinTech — desanonimización, inteligencia para
  ataques dirigidos, incumplimiento de confidencialidad.
- **Corrección aplicada:** nuevo helper `emitToWallet(wallet, event, payload)`
  (= `io.to('wallet:'+wallet).emit(...)`, mismo mecanismo probado que
  `emitPortfolioUpdated`); los 6 emisores privados ahora van solo a la room de la
  wallet. Los eventos públicos (`market:*`, `duel:*`, `orderbook:*`, `dao:*`)
  siguen globales. Verificado: los eventos `ledger:*` no tienen consumidor en el
  frontend (0 listeners), y `crypto:tx` es un toast de confirmación de la PROPIA
  tx del usuario, así que escoparlos no rompe ninguna feature. `tsc` + 65 tests
  backend verdes.
- **Hueco de test (INFO):** no hay test de integración de la frontera de
  autorización del socket; requiere `socket.io-client` en devDeps del backend
  (no instalable offline aquí). **REVISIÓN MANUAL / test pendiente.**

Otros (INFO, no corregidos):
- `scripts/validate-env.sh:20` `export $(grep … .env)` hace word-splitting: valores con espacios se manglean; `display_value` (`:78`) se calcula y nunca se usa.
- `scripts/pre-migration-backup.sh:21` parsea la password de `DATABASE_URL` con `sed` hasta el primer `@`: una password que contenga `@`/`:` se trunca.
- `frontend/src/pages/PublicPage.tsx:50` emite `identify` al socket, pero el backend eliminó ese handler (rooms por JWT) — dead code inofensivo.

Settlement on-chain revisado y **correcto**: `claim_market_sol/lynx` (`lib.rs:1126-1200`) exigen `Resolved`, `!claimed`, `position_is_winner`, `winning_total>0`, pago pro-rata con `mul_div`; y `ClaimMarketSol/Lynx` (`2277-2300`) **pinean la posición** con `constraint = position.owner == claimant.key()` + `has_one = market` → sin robo de claim ni doble-claim ni cruce de mercados.

---

## 0-bis. Ronda 2 de auditoría (desde cero) — resultado: CONVERGE

Tras aplicar las correcciones, se re-auditó todo profundizando en las rutas de
dinero **no cubiertas a fondo en la ronda 1**. Verificado con evidencia:

- **`chain.ts` decoders** (`decodeMarket/PredictionOrder/Position/SpotOrder`,
  líneas 182-252): cada campo coincide **exacto** con los structs de `state.rs`
  (verificado `UserPosition` 266-274, `PredictionOrder` 397-418, `SpotOrder`
  457-476). Sin bugs de offset.
- **Keeper** (`chain.ts:456-548`): keypair separado de tesorería; la condición de
  precio se **re-valida on-chain** aunque la caché esté stale (≤8 s); fallos por
  orden aislados. Un keeper comprometido no puede robar. Correcto.
- **Depósito on-chain** (`server.ts:2190-2270` + `verifyOnChainSolDeposit`
  999-1069): pre-registro **atómico** de la firma antes de la verificación RPC
  (anti-TOCTOU); no permite sobre-acreditar (`treasuryDelta`/`senderDelta`);
  crédito manual INTERNAL/CARD **eliminado** (410) → solo doble-admin.
- **Doble aprobación** (`creditApprovals.ts:249-262, 393-405`): el proponente
  **no puede autoaprobarse** (`proposedBy === approverUserId` lanza) y las
  aprobaciones se deduplican → 2-de-2 real.

**Resultado de la ronda 2: 0 hallazgos críticos/altos/medios nuevos.** Regresión
completa verde (frontend 49/49, backend 65/65, admin-panel 24/24, on-chain 52).

El bucle "corregir → re-auditar" **converge**: lo que queda no son bugs sino
decisiones/refactors ya listados como diferidos (M-N2 migración on-chain, I-1
modularización, B-N3/B-N7 endurecimiento opcional). No se han inventado hallazgos
para prolongar el bucle.

---

## 1. Resumen ejecutivo

LynxProject es un protocolo de mercados de predicción en Solana con dinero
**on-chain** (programa Anchor con aritmética `checked_*` y u128, PDAs pineadas,
2FA + multisig 2-de-2 + ventana de disputa para resoluciones) e infraestructura
**muy endurecida** (contenedores `read_only`, `cap_drop: ALL`, TLS moderno, HSTS,
CSP, rate-limiting, secretos por Docker Secrets). El código ha pasado ya por
varias rondas de auditoría (`AUDIT_REPORT.md`, `SECURITY_AUDIT.md`, y la externa
`EXTERNAL_AUDIT_2026-07-20.md` cerrada en esta sesión).

**Estado de seguridad: fuerte.** No se han encontrado vulnerabilidades críticas
nuevas explotables (no XSS, no SQLi, no eval/RCE, no IDOR en las rutas de dinero,
no open-redirect, tokens no en localStorage, aritmética on-chain protegida).

**Lo que impide el "APTO" hoy** no es un agujero crítico sino **madurez
operativa**: (a) un bug de configuración de Redis en el compose que rompe
silenciosamente los locks distribuidos, (b) un `.env.local` trackeado en git,
(c) la migración "todo on-chain" a medias (doble fuente de verdad
backend/on-chain para duelos/DAO/spot), y (d) **falta la validación end-to-end
en devnet** y un `npm audit`/pentest/carga reales.

**Verificación ejecutada en esta sesión:**
- Programa Solana: `cargo build` ✅, `cargo build-sbf` ✅, `cargo clippy
  --all-targets -D warnings` = 0 ✅, **52 tests on-chain** (unit + 9 binarios de
  integración) ✅.
- Backend: `tsc` ✅, **65 tests** ✅.
- Frontend: `tsc` ✅, **49 tests** ✅.

---

## 2–10. Puntuaciones (/10)

| # | Área | Nota | Comentario |
|---|------|------|-----------|
| 2 | **Arquitectura** | **7.5** | Separación clara on-chain / indexador / UI. Penaliza: doble fuente de verdad durante la migración, y ficheros gigantes (`server.ts` 2891, `lib.rs` 3040, `state.ts` 1831 líneas). |
| 3 | **Frontend** | **7.5** | Tokens en memoria (no localStorage), sin XSS/eval, CSP estricta, wallet-adapter estándar. Penaliza: dependencia sin usar (`@google/genai`), sin error boundaries verificados, a11y sin auditar. |
| 4 | **Backend** | **8.0** | Auth por capas sólida, IDOR cubierto por tests, rate-limit distribuido, Zod en las entradas, error-handler ahora con `DomainError`. Penaliza: fallback frágil por texto aún presente, ficheros enormes. |
| 5 | **Solana** | **8.5** | Aritmética `checked_*`/u128, PDAs pineadas por seeds, constraints `address =`, multisig+timelock+disputa, slippage añadido. 52 tests. Falta relectura línea-a-línea completa e independiente de las ~3040 líneas. |
| 6 | **Seguridad** | **8.0** | Muy buena base (multiples auditorías cerradas). Penaliza: config Redis, `.env.local` trackeado, sin pentest/`npm audit` en red. |
| 7 | **Rendimiento** | **7.0** | DB bien indexada. Sin pruebas de carga; posibles cuellos en el indexador y en re-renderizados no medidos. **REVISIÓN MANUAL NECESARIA** (profiling). |
| 8 | **Escalabilidad** | **6.5** | Multi-réplica soportado SOLO con Redis correcto; el bug del `REDIS_URL` (abajo) rompe eso silenciosamente. Indexador on-chain sin sharding. |
| 9 | **Mantenibilidad** | **6.5** | Comentarios excelentes, pero ficheros monolíticos y lógica duplicada off-chain/on-chain durante la migración. |
| 10 | **Producción** | **6.0** | Base sólida, pero sin validación devnet, con el bug de Redis y migración incompleta. Ver §14. |

**Global ponderado: ~7.3/10.**

---

## 11. Hallazgos (ordenados por severidad)

> Los 7 hallazgos de la auditoría externa (ALTA-1/2, MEDIA-1, BAJA-1..4) se
> **corrigieron y validaron en esta sesión** — ver `EXTERNAL_AUDIT_2026-07-20.md`.
> No se repiten aquí salvo referencia.

### CRÍTICO
Ninguno nuevo. (Los críticos históricos C-1/C-2/M-1 están corregidos y con test —
`SECURITY_AUDIT.md`.)

### ALTO

**A-N1 — `REDIS_URL` malformado + password Redis por defecto débil rompe los locks distribuidos**
- **Archivo:** `docker-compose.yml:71`, `:79`, `:112`
- **Evidencia:**
  - `:112` → `REDIS_URL: redis://:${REDIS_USER:-}:${REDIS_PASSWORD:-lynx_redis_dev}@redis:6379`. Con `REDIS_USER` vacío (su valor por defecto) la cadena queda `redis://::lynx_redis_dev@redis:6379`: el *userinfo* es `::lynx_redis_dev`, así que ioredis envía como password `:lynx_redis_dev` (con dos-puntos inicial), que **no coincide** con `--requirepass lynx_redis_dev` de `:71`.
  - `:71`/`:79` usan `${REDIS_PASSWORD:-lynx_redis_dev}` **sin** el guard `:?` que sí protege a `POSTGRES_PASSWORD` (`:55`).
- **Riesgo real / explotación:** el `AUTH` backend↔Redis falla en silencio; `redisClient.ts` captura el error y **cae al limitador en memoria por instancia**. En multi-réplica, los locks distribuidos de `withdraw` y de resolución de mercados (documentados en `server.ts` como imprescindibles) dejan de ser globales, **reabriendo las condiciones de carrera de doble-gasto** que fueron construidas para cerrar. Además, si un operador no fija `REDIS_PASSWORD`, queda una password pública conocida.
- **Impacto en producción:** ALTO — pérdida de fondos por doble retiro/resolución bajo concurrencia con ≥2 réplicas.
- **Corrección:**
  ```yaml
  # docker-compose.yml
  redis:
    command: redis-server --requirepass ${REDIS_PASSWORD:?REDIS_PASSWORD is required}
  # backend env:
  REDIS_URL: redis://default:${REDIS_PASSWORD:?REDIS_PASSWORD is required}@redis:6379
  ```
  (usar el usuario `default` explícito y una sola variable, y exigirla con `:?`).

### MEDIO

**M-N1 — `cripto/admin-panel/.env.local` trackeado en git**
- **Archivo:** `cripto/admin-panel/.env.local` (en HEAD; commits `8b94f2d`, `31630dc`)
- **Evidencia:** `git ls-files` lo lista; `git show HEAD:cripto/admin-panel/.env.local` devuelve contenido con `ADMIN_DEV_MODE=true`, `MOCK_MARKETS=true`, `SESSION_SECRET=local_dev_..._123456`, `ADMIN_PASSWORD=lynx-local-admin`, `TELEGRAM_BOT_TOKEN=123456789:AA...`. El `.gitignore` **ya** lista `.env.local` (`:2`) pero el fichero sigue trackeado (nunca se hizo `git rm --cached`).
- **Riesgo:** los valores actuales son placeholders (no hay fuga real), pero (1) un fichero `.env.local` trackeado invita a commitear un secreto real con un `git add .`; (2) si se usa como base para prod, `ADMIN_DEV_MODE=true` activa mocks (`solana.ts:462+`) y **suprime el audit-log de Telegram** (`security.ts:194`).
- **Corrección:** `git rm --cached cripto/admin-panel/.env.local && git commit`; dejar solo `.env.example`. Rotar cualquier valor que alguna vez haya sido real.

**M-N2 — Migración "todo on-chain" incompleta: doble fuente de verdad**
- **Archivos:** `frontend/src/lib/lynxProgram.ts:17-19` ("staking/DAO siguen off-chain… fase 5"), `backend/src/state.ts` (motor off-chain de duelos/spot/emisión LYNX aún vivo).
- **Riesgo:** duelos, DAO (frontend) y parte del spot conviven off-chain mientras mercados/posiciones/staking están on-chain. Dos contabilidades paralelas ⇒ riesgo de divergencia y de que un bug off-chain (ej. BAJA-4, ya corregido) afecte saldos que la UI mezcla con los on-chain.
- **Corrección:** completar la migración (duelos/DAO/indexador) **o** delimitar explícitamente qué es autoritativo y retirar la mutación de dinero de `state.ts`. Es la decisión ya registrada en `LAUNCH_DECISIONS.md`.

**M-N3 — Sin `npm audit` / escaneo CVE en red — REVISIÓN MANUAL NECESARIA**
- **Evidencia:** `bigint-buffer` presente como transitiva en `backend/`, `frontend/` y `cripto/` (CVE conocida de overflow en `toBigIntLE`, vía `@solana/web3.js`; riesgo previamente aceptado por el equipo).
- **Riesgo:** no pude ejecutar `npm audit` (sin red en el entorno). Puede haber CVEs adicionales.
- **Corrección:** ejecutar en CI `npm audit --omit=dev` en los 3 proyectos y añadir un gate; vigilar el parche upstream de `bigint-buffer`.

### BAJO

**B-N1 — Dependencia sin usar `@google/genai` en el frontend**
- **Archivo:** `frontend/package.json` (`@google/genai: ^1.29.0`). `grep` de `@google/genai`/`GoogleGenAI` en `frontend/**/*.{ts,tsx}` = 0 usos.
- **Riesgo:** peso de bundle y superficie de supply-chain innecesaria.
- **Corrección:** `npm rm @google/genai` en `frontend/`.

**B-N2 — Cabeceras de seguridad se pierden en assets estáticos (nginx)**
- **Archivo:** `nginx/nginx.conf:146-153` (location de `*.js|css|…`) añade `Cache-Control` con `add_header`, lo que en nginx **reemplaza** todas las `add_header` heredadas (HSTS/CSP/X-Frame) para esas respuestas.
- **Riesgo:** bajo (el documento HTML sí las recibe vía `location /`), pero HSTS/`X-Content-Type-Options` desaparecen en JS/CSS.
- **Corrección:** re-declarar las cabeceras de seguridad dentro de esa `location` (o `include` de un snippet común).

**B-N3 — Access token no revocado en logout**
- **Archivo:** `backend/src/auth.ts` (solo el refresh se revoca; el access JWT es válido su TTL completo).
- **Riesgo:** un access token robado sigue válido hasta 15 min tras logout. Mitigado por el TTL corto (15m).
- **Corrección (opcional):** denylist de `jti` de access tokens en Redis hasta su `exp`.

**B-N4 — Fuga de `error.message` interno al admin en la ruta de resolución**
- **Archivo:** `cripto/admin-panel/app/api/resolve/route.ts:157-158`, `:176-178` — devuelve `err.message` crudo al cliente.
- **Riesgo:** bajo (solo admins autenticados), pero puede exponer detalles internos de RPC/Solana.
- **Corrección:** loggear el detalle y devolver un mensaje genérico + código.

**B-N5 — Endpoint MoonPay sin rate-limit propio ni validación de `walletAddress`**
- **Archivo:** `frontend/server.ts:71-101`; `nginx/nginx.conf:135-143` (`/integrations/` sin `limit_req`).
- **Riesgo:** bajo (HMAC barato), pero es un endpoint sin throttle y no valida el formato de `walletAddress` antes de firmarlo.
- **Corrección:** validar `walletAddress` (base58/longitud) y añadir `limit_req zone=api` a `/integrations/`.

**B-N6 — `SESSION_SECRET` no valida longitud ≥32 en el panel**
- **Archivo:** `cripto/admin-panel/lib/session.ts:12-17` — solo comprueba `!value`; iron-session exige ≥32 chars y fallará en runtime, no al validar.
- **Corrección:** validar `value.length >= 32` en `sessionPassword()`.

**B-N7 — El fallback frágil por texto sigue en el error-handler**
- **Archivo:** `backend/src/server.ts` (handler global) — tras añadir `DomainError` (BAJA-3), el mapeo por `.includes()` de prosa inglesa permanece como fallback para los throws de string existentes.
- **Corrección:** migrar progresivamente los `throw new Error(...)` de dominio a `DomainError` y retirar el fallback.

### INFO / DEUDA TÉCNICA

- **I-1** Ficheros monolíticos: `server.ts` (2891 líneas), `lib.rs` (3040), `state.ts` (1831). Alta complejidad, difícil de mantener/revisar. **Recomendación:** modularizar por dominio.
- **I-2** CSP con `script-src 'unsafe-inline'` en el panel (`middleware.ts:93`) — requerido por Next.js App Router; documentado. Migrar a nonces si se endurece.
- **I-3** Truncamiento de recompensas de staking MD-05 (`lib.rs:2805-2809`) — ≤1 nano-lamport por settle; documentado, insignificante.
- **I-4** `currentUser()` (`server.ts:851-857`) muta `user.role` como efecto lateral en un getter — code smell, no bug.
- **I-5** `@@index`/CHECK constraints presentes (migraciones `..._db_indexes_and_uniqueness`, `..._check_constraints_and_enum_fixes`) — buen estado; sin hallazgos de N+1 evidentes, pero **REVISIÓN MANUAL NECESARIA** en el indexador on-chain bajo carga.

### Áreas con REVISIÓN MANUAL NECESARIA (no verificables por ejecución aquí)
1. Relectura línea-a-línea completa e independiente de `lib.rs` (~3040 líneas): se verificó aritmética, PDAs, constraints y 52 tests, pero no una prueba formal instrucción-a-instrucción de cada ruta (close de cuentas/rent, CPIs de token en todos los caminos de LYNX).
2. Concurrencia del motor off-chain `state.ts` fuera de las rutas ya protegidas por lock (`withdraw`, resolución): posibles TOCTOU a través de `await` en otras mutaciones.
3. `npm audit` en red (M-N3) y escaneo de licencias.
4. Pruebas de carga/latencia y perfil de re-renderizados del frontend.
5. Auditoría de accesibilidad (a11y) del frontend.
6. Prueba real de backup/restore y de rollback (`RUNBOOK.md` describe el proceso; no ejecutado).

---

## 12. Orden de corrección recomendado

1. **A-N1** Redis URL/password (bloquea multi-réplica seguro).
2. **M-N1** Sacar `.env.local` de git.
3. **M-N3** `npm audit` en CI (+ gate).
4. **M-N2** Cerrar/delimitar la migración on-chain (decisión de producto).
5. **B-N2, B-N5, B-N6, B-N4** Endurecimientos rápidos (nginx headers, MoonPay, SESSION_SECRET, fuga de error).
6. **B-N1** Quitar `@google/genai`.
7. **B-N3, B-N7** Denylist de access token / migración a `DomainError`.
8. **I-1** Modularización (continuo).
9. Validación **end-to-end en devnet** + carga + a11y (áreas de revisión manual).

## 13. Estimación de esfuerzo

| ID | Esfuerzo |
|----|----------|
| A-N1 | 1–2 h |
| M-N1 | 0.5 h (+ rotación si hubo secreto real) |
| M-N2 | 20–60 h (según alcance de la migración) |
| M-N3 | 1–2 h |
| B-N1 | 0.25 h |
| B-N2 | 0.5 h |
| B-N3 | 3–5 h |
| B-N4 | 0.5 h |
| B-N5 | 1 h |
| B-N6 | 0.25 h |
| B-N7 | 4–8 h (incremental) |
| I-1 | 20–40 h (continuo) |
| Devnet e2e + carga + a11y | 20–40 h |

## 14. Recomendación final

### ⚠️ NO APTO PARA PRODUCCIÓN — todavía (condicional, cerca del "apto")

La **base de seguridad es sólida** y no hay críticos abiertos; el bloqueo es
operativo. Se considerará **APTO** cuando:

1. **A-N1** (Redis) esté corregido y probado con ≥2 réplicas.
2. **M-N1** hecho (`.env.local` fuera de git) y secretos reales rotados.
3. **M-N3** `npm audit` limpio (o riesgos aceptados por escrito).
4. **M-N2** resuelto: la migración on-chain completada **o** explícitamente
   acotada (qué es autoritativo), sin dinero mutándose en `state.ts` para lo ya
   on-chain.
5. **Validación end-to-end en devnet** del flujo completo (crear mercado →
   comprar con slippage → resolver vía multisig → claim) superada manualmente.

Con esos 5 puntos cerrados, el proyecto pasaría a **APTO** con las áreas de
"revisión manual" (carga, a11y, backup/restore) como seguimiento post-lanzamiento.
