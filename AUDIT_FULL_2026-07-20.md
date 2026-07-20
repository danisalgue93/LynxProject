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
