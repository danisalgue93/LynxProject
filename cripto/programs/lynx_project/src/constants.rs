pub const BPS_DENOMINATOR: u64 = 10_000;

pub const EVENT_PROTOCOL_FEE_BPS: u64 = 1_000;
pub const STAKER_REWARD_FEE_BPS: u64 = 500;
pub const TREASURY_EVENT_FEE_BPS: u64 = 500;
pub const GLOBAL_TRADE_FEE_BPS: u64 = 10;
pub const LYNX_EVENT_BURN_BPS: u64 = 1_500;

// Minting split for LYNX emitted on resolved SOL markets:
// 85% to the participant (user), 15% sold on the order book at the
// initial listing price (see INITIAL_SALE_PRICE_LAMPORTS below).
pub const LYNX_PARTICIPANT_BPS: u64 = 8_500;
pub const LYNX_TREASURY_BPS: u64 = 0;
pub const LYNX_INITIAL_SALE_BPS: u64 = 1_500;

// LYNX has 6 decimals. 1 SOL = 1_000_000_000 lamports should mint
// 1 LYNX = 1_000_000 micro-LYNX, so lamports / 1_000.
pub const LAMPORTS_TO_MICRO_LYNX_DENOMINATOR: u64 = 1_000;

pub const ORACLE_TIMEOUT_SECONDS: i64 = 3_600;
pub const REWARD_SCALE: u128 = 1_000_000_000_000;

// --- TWAP del supply circulante (SC-01) ---
// El ratio de minteo de LYNX depende del supply circulante. Leerlo de forma
// instantanea permitia un ataque atomico: quemar LYNX en la misma transaccion
// (o el mismo bloque) en que se resuelve un mercado hunde el circulante, salta
// a un tramo mas generoso (hasta 40x mas LYNX) y el atacante cobra el mercado a
// ese ratio inflado, sin riesgo ni exposicion temporal.
//
// Promediando el circulante sobre una ventana de muchas horas, una quema de
// ultimo minuto solo mueve 1 de SUPPLY_SNAPSHOT_COUNT muestras: el efecto se
// diluye a ~1/24 y el ataque deja de ser rentable. Para mover el promedio de
// verdad hay que sostener la reduccion de supply durante horas, a la vista de
// todos on-chain y afectando por igual a todas las resoluciones de la ventana.
pub const SUPPLY_SNAPSHOT_COUNT: usize = 24;

// Cadencia minima entre muestras del crank. Con 24 muestras a 1h, la ventana
// del TWAP es de ~24 horas.
pub const SUPPLY_SNAPSHOT_INTERVAL_SECONDS: i64 = 3_600;

// --- Gobernanza / multisig / disputa de resoluciones ---
// Ventana durante la cual una resolucion propuesta por el oraculo puede ser
// disputada por cualquiera de los firmantes del multisig antes de que los
// fondos se muevan de verdad. Mientras el mercado esta en PendingResolution
// ningun claim/payout ocurre todavia.
pub const DISPUTE_WINDOW_SECONDS: i64 = 86_400; // 24 horas

// Una vez que una propuesta de gobernanza (transfer_admin, pausa, resolucion
// admin de fallback, etc.) alcanza el umbral de aprobaciones, hay que esperar
// este timelock antes de poder ejecutarla, para dar visibilidad publica antes
// de que surta efecto.
pub const GOVERNANCE_EXECUTION_DELAY_SECONDS: i64 = 3_600; // 1 hora

// Numero maximo de firmantes soportados por el multisig on-chain (tamano fijo
// para que las cuentas tengan espacio predecible).
pub const MAX_MULTISIG_SIGNERS: usize = 5;

// Tiempo maximo que una propuesta de gobernanza puede permanecer abierta
// recolectando aprobaciones antes de expirar y tener que volver a crearse.
pub const PROPOSAL_TTL_SECONDS: i64 = 7 * 86_400; // 7 dias

pub const MICRO_LYNX_PER_LYNX: u64 = 1_000_000;

pub const TIER_1_MAX_LYNX: u64 = 500_000;
pub const TIER_2_MAX_LYNX: u64 = 1_000_000;
pub const TIER_3_MAX_LYNX: u64 = 1_500_000;
pub const TIER_4_MAX_LYNX: u64 = 2_000_000;
pub const TIER_5_MAX_LYNX: u64 = 2_500_000;
pub const TIER_6_MAX_LYNX: u64 = 3_000_000;
pub const TIER_7_MAX_LYNX: u64 = 3_500_000;
pub const TIER_8_MAX_LYNX: u64 = 4_000_000;
pub const TIER_9_MAX_LYNX: u64 = 4_500_000;
pub const TIER_10_MAX_LYNX: u64 = 5_000_000;

pub const RATIO_TIER_1_BPS: u64 = 10_000;
pub const RATIO_TIER_2_BPS: u64 = 8_000;
pub const RATIO_TIER_3_BPS: u64 = 7_000;
pub const RATIO_TIER_4_BPS: u64 = 6_000;
pub const RATIO_TIER_5_BPS: u64 = 5_000;
pub const RATIO_TIER_6_BPS: u64 = 4_000;
pub const RATIO_TIER_7_BPS: u64 = 3_000;
pub const RATIO_TIER_8_BPS: u64 = 2_000;
pub const RATIO_TIER_9_BPS: u64 = 1_000;
pub const RATIO_TIER_10_BPS: u64 = 500;
pub const RATIO_FLOOR_BPS: u64 = 250;

// --- Libro de ordenes LYNX/SOL on-chain ---
// Escala usada para representar precios fraccionarios (lamports por
// micro-LYNX) sin usar numeros de punto flotante on-chain.
pub const PRICE_SCALE: u128 = 1_000_000_000;

// --- Protocol duel exposure cap (SC-03) ---
// Maximum total SOL (lamports) the protocol can be simultaneously exposed
// to across all active 1v1vProtocol duels. Roughly 1 000 SOL as a starting
// value; configurable per-deployment via governance.
pub const MAX_PROTOCOL_DUEL_EXPOSURE_LAMPORTS: u64 = 1_000_000_000_000; // 1 000 SOL

/// Maximum single order size in lamports (100 SOL). Prevents accidental
/// catastrophic trades and reduces the impact of a compromised keypair.
pub const MAX_ORDER_LAMPORTS: u64 = 100_000_000_000;

/// Minimum single order size in lamports (0.001 SOL). Prevents dust orders
/// that waste on-chain storage rent without meaningful economic activity.
pub const MIN_ORDER_LAMPORTS: u64 = 1_000_000;

// --- DAO on-chain governance (user proposals + stake-weighted voting) ---
// Bounds on how long a DAO proposal's voting window may stay open. A minimum
// gives everyone a fair chance to vote; a maximum stops a proposal from sitting
// open indefinitely.
pub const DAO_MIN_PROPOSAL_DURATION_SECONDS: i64 = 3_600; // 1 hour
pub const DAO_MAX_PROPOSAL_DURATION_SECONDS: i64 = 30 * 86_400; // 30 days
