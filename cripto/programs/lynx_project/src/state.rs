use anchor_lang::prelude::*;
use crate::constants::{MAX_MULTISIG_SIGNERS, SUPPLY_SNAPSHOT_COUNT};

// Ring buffer con las ultimas SUPPLY_SNAPSHOT_COUNT muestras del supply LYNX
// circulante, alimentado por el crank permissionless record_supply_snapshot.
//
// Existe para cerrar SC-01: el ratio de minteo se deriva del PROMEDIO de esta
// ventana en vez del valor instantaneo, de modo que una quema atomica justo
// antes de resolver un mercado no puede inflar el ratio (ver constants.rs).
#[account]
pub struct CirculatingSupplyTwap {
    pub config: Pubkey,
    pub snapshots: [u64; SUPPLY_SNAPSHOT_COUNT],
    // Muestras validas escritas hasta ahora. Satura en SUPPLY_SNAPSHOT_COUNT;
    // hasta entonces el promedio solo considera las primeras `count`.
    pub count: u8,
    // Cursor circular de escritura.
    pub next_index: u8,
    pub last_snapshot_ts: i64,
    pub bump: u8,
}

impl CirculatingSupplyTwap {
    pub const LEN: usize = 8 + 32 + 8 * SUPPLY_SNAPSHOT_COUNT + 1 + 1 + 8 + 1;

    /// Promedio del supply circulante sobre las muestras disponibles.
    /// Devuelve None mientras no haya ninguna (deployment recien creado).
    pub fn average(&self) -> Option<u64> {
        if self.count == 0 {
            return None;
        }
        let n = self.count as usize;
        // u128 para que la suma de hasta 24 valores u64 no pueda desbordar.
        let sum: u128 = self.snapshots[..n].iter().map(|&s| s as u128).sum();
        u64::try_from(sum / n as u128).ok()
    }
}

#[account]
pub struct ProtocolConfig {
    pub admin: Pubkey,
    pub treasury: Pubkey,
    pub lynx_mint: Pubkey,
    pub stake_vault: Pubkey,
    pub rewards_vault: Pubkey,
    pub total_lynx_supply: u64,
    pub total_lynx_burned: u64,
    pub total_staked: u64,
    pub reward_per_token_scaled: u128,
    pub bump: u8,
    pub rewards_vault_bump: u8,
    // Interruptor de emergencia. Cuando esta en `true` se bloquean nuevas
    // operaciones de riesgo (compra de posiciones, creacion/aceptacion de
    // duelos, minteo de distribucion LYNX). Los claims/retiros de fondos ya
    // resueltos y la cancelacion de duelos NO se bloquean, para que los
    // usuarios siempre puedan recuperar lo que ya es suyo. Solo se puede
    // cambiar via una GovernanceProposal (multisig), nunca por una sola clave.
    pub paused: bool,
    // Marca si este ProtocolConfig ya tiene un Multisig inicializado
    // (init_multisig es una operacion de una sola vez).
    pub multisig_initialized: bool,
    // --- Protocol duel exposure management (SC-03) ---
    // Current total SOL (lamports) the protocol is exposed to across all
    // active 1v1vProtocol duels. Incremented on creation, decremented on
    // resolution/cancellation so it never drifts.
    pub protocol_duel_exposure: u64,
    // Maximum allowed protocol_duel_exposure (lamports). Enforced in
    // create_duel when duel_type == OneVOneVProtocol. Configurable via
    // governance so it can be raised as the treasury grows.
    pub max_protocol_duel_exposure: u64,
}

impl ProtocolConfig {
    // 8 disc + 5 Pubkey + 3 u64 + 1 u128 + 4 u8/bool + 2 u64.
    pub const LEN: usize = 8 + 32 * 5 + 8 * 3 + 16 + 4 + 8 * 2;
}

#[account]
pub struct Multisig {
    pub config: Pubkey,
    pub signers: [Pubkey; MAX_MULTISIG_SIGNERS],
    pub signer_count: u8,
    pub threshold: u8,
    // Contador incremental para derivar PDAs de propuestas unicas
    // (seeds = [b"gov_proposal", multisig.key(), proposal_seq.to_le_bytes()]).
    pub proposal_seq: u64,
    pub bump: u8,
}

impl Multisig {
    pub const LEN: usize = 8 + 32 + 32 * MAX_MULTISIG_SIGNERS + 1 + 1 + 8 + 1;
}

// Accion concreta que una GovernanceProposal ejecuta una vez alcanzado el
// umbral de aprobaciones y pasado el timelock. Mantenemos esto como un enum
// cerrado (en vez de instrucciones arbitrarias) para que cada firmante sepa
// exactamente que esta aprobando, sin poder ser enganado por calldata opaca.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum GovernanceAction {
    TransferAdmin { new_admin: Pubkey },
    SetPaused { paused: bool },
    AddSigner { signer: Pubkey },
    RemoveSigner { signer: Pubkey },
    SetThreshold { threshold: u8 },
    // Resolucion de fallback cuando el oraculo nunca propuso un resultado
    // dentro de ORACLE_TIMEOUT_SECONDS. Requiere multisig completo en vez de
    // una sola clave admin (ver C3 del informe de auditoria).
    ResolveMarketAdmin { market: Pubkey, result: Outcome },
}

impl GovernanceAction {
    // Cota superior conservadora del tamano serializado (1 byte de
    // discriminante + el mayor payload posible, que es
    // ResolveMarketAdmin{Pubkey(32) + Outcome(1)}).
    pub const MAX_LEN: usize = 1 + 32 + 1 + 8;
}

#[account]
pub struct GovernanceProposal {
    pub multisig: Pubkey,
    pub proposer: Pubkey,
    pub proposal_id: u64,
    pub action: GovernanceAction,
    // Lista de pubkeys que ya aprobaron. Pubkey::default() = hueco vacio.
    pub approvals: [Pubkey; MAX_MULTISIG_SIGNERS],
    pub approval_count: u8,
    // 0 mientras no se alcanza el umbral; en cuanto approval_count >=
    // threshold se fija a `now` una sola vez, arrancando el timelock de
    // GOVERNANCE_EXECUTION_DELAY_SECONDS antes de poder ejecutar.
    pub threshold_reached_ts: i64,
    pub executed: bool,
    pub cancelled: bool,
    pub created_ts: i64,
    pub expires_ts: i64,
    pub bump: u8,
}

impl GovernanceProposal {
    pub const LEN: usize = 8
        + 32
        + 32
        + 8
        + GovernanceAction::MAX_LEN
        + 32 * MAX_MULTISIG_SIGNERS
        + 1
        + 8
        + 1
        + 1
        + 8
        + 8
        + 1;
}

#[account]
pub struct RewardsVault {
    pub bump: u8,
}

impl RewardsVault {
    pub const LEN: usize = 8 + 1;
}

#[account]
pub struct Market {
    pub id: u64,
    pub admin: Pubkey,
    pub vault: Pubkey,
    pub oracle_authority: Pubkey,
    pub title: String,
    pub currency: Currency,
    pub status: MarketStatus,
    pub is_ternary: bool,
    pub cutoff_ts: i64,
    pub resolve_ts: i64,
    pub oracle_deadline: i64,
    pub resolved_ts: i64,
    pub result: Outcome,
    pub pool_total: u64,
    pub yes_total: u64,
    pub no_total: u64,
    pub draw_total: u64,
    pub winning_total: u64,
    pub burned_lynx: u64,
    pub bump: u8,
    pub vault_bump: u8,
    // Bump for the per-market LYNX token vault PDA (seeds = [b"lynx_vault", market.key()]).
    // Previously market_lynx_vault was an arbitrary token account validated only by
    // mint+owner, so the same account could be reused across multiple LYNX markets and
    // mix custody between them. Storing the bump here lets buy_position_lynx_with_burn /
    // claim_market_lynx pin the vault to this specific market via seeds instead.
    pub lynx_vault_bump: u8,
    // LYNX mint ratio (bps), captured once in finalize_market_and_fees when this
    // market resolves (Currency::SOL only). mint_lynx_distribution reads this
    // fixed value instead of recomputing current_mint_ratio_bps() on every
    // per-position claim, so every winner of THIS market gets the same ratio
    // regardless of when they claim or how much the global LYNX supply has
    // moved via unrelated markets/duels in the meantime. Zero until resolved.
    pub mint_ratio_bps: u64,
    // Set by sweep_unclaimed_market_sol / sweep_unclaimed_market_lynx when a market
    // resolves with winning_total == 0 (nobody backed the winning outcome) and its
    // pool has been swept to the treasury so it doesn't stay stuck in vault /
    // market_lynx_vault forever. Guards against sweeping the same market twice.
    pub swept: bool,
    // --- Disputa de resolucion (ver constants::DISPUTE_WINDOW_SECONDS) ---
    // Resultado propuesto por propose_resolution() (oraculo) o por la
    // ejecucion de una GovernanceProposal::ResolveMarketAdmin (multisig).
    // Outcome::Unresolved mientras no hay ninguna propuesta pendiente.
    pub proposed_result: Outcome,
    // Timestamp en el que se registro proposed_result. finalize_resolution()
    // solo puede ejecutarse cuando now >= proposed_ts + DISPUTE_WINDOW_SECONDS
    // y nadie la ha disputado con dispute_resolution() antes de ese momento.
    pub proposed_ts: i64,
    // Snapshot of the LYNX mint ratio (bps) taken at the time the market
    // enters PendingResolution (propose_resolution). Used by
    // finalize_market_and_fees instead of calling current_mint_ratio_bps()
    // which is manipulable during the dispute window.
    pub mint_ratio_snapshot_bps: u64,
    // Tracks total lamports paid out to winners via claim_market_sol.
    // Used by sweep_unclaimed_market_sol to detect when all claims are
    // complete and only division-remainder dust remains in the vault.
    pub total_claimed: u64,
    // --- Trazabilidad (M3 del informe de auditoria) ---
    // Quien firmo la instruccion que efectivamente movio los fondos y marco
    // el mercado como Resolved: el oracle_authority si vino de
    // finalize_resolution(), o la cuenta GovernanceProposal si vino del
    // fallback admin via execute_resolve_market_admin. Pubkey::default()
    // mientras el mercado no este resuelto.
    pub resolved_by: Pubkey,
}

impl Market {
    pub const TITLE_MAX: usize = 128;
    pub const LEN: usize = 8
        + 8
        + 32 * 4
        + (4 + Self::TITLE_MAX)
        + 1
        + 1
        + 1
        + 8 * 4
        + 1
        + 8 * 6
        + 1
        + 1
        + 1
        + 8    // mint_ratio_bps
        + 1    // swept
        + 1    // proposed_result
        + 8    // proposed_ts
        + 8    // mint_ratio_snapshot_bps
        + 8    // total_claimed
        + 32;  // resolved_by
}

#[account]
pub struct MarketVault {
    pub market: Pubkey,
    pub bump: u8,
}

impl MarketVault {
    pub const LEN: usize = 8 + 32 + 1;
}

#[account]
pub struct UserPosition {
    pub market: Pubkey,
    pub owner: Pubkey,
    pub outcome: Outcome,
    pub amount: u64,
    pub claimed: bool,
    pub lynx_minted: bool,
    pub bump: u8,
}

impl UserPosition {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 8 + 1 + 1 + 1;
}

#[account]
pub struct StakePosition {
    pub owner: Pubkey,
    pub amount: u64,
    pub reward_debt_scaled: u128,
    pub pending_rewards: u64,
    pub bump: u8,
}

impl StakePosition {
    pub const LEN: usize = 8 + 32 + 8 + 16 + 8 + 1;
}

#[account]
pub struct Duel {
    pub parent_market: Pubkey,
    pub creator: Pubkey,
    pub rival: Pubkey,
    pub id: u64,
    pub amount: u64,
    pub creator_outcome: Outcome,
    pub rival_outcome: Outcome,
    pub duel_type: DuelType,
    pub status: DuelStatus,
    pub expires_ts: i64,
    pub bump: u8,
    pub vault_bump: u8,
}

impl Duel {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 8 + 1 + 1 + 1 + 1 + 8 + 1 + 1;
}

#[account]
pub struct DuelVault {
    pub duel: Pubkey,
    pub bump: u8,
}

impl DuelVault {
    pub const LEN: usize = 8 + 32 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Currency {
    SOL,
    LYNX,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Open,
    Active,
    CutOff,
    // Un resultado fue propuesto (por el oraculo via propose_resolution, o
    // por una GovernanceProposal::ResolveMarketAdmin ya ejecutada) pero
    // todavia esta dentro de la ventana de disputa: ningun fondo se ha
    // movido todavia. dispute_resolution() puede devolver el mercado a
    // CutOff; finalize_resolution() lo lleva a Resolved cuando pasa la
    // ventana sin disputa.
    PendingResolution,
    Resolved,
    Expired,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Unresolved,
    Yes,
    No,
    Draw,
}

impl Outcome {
    pub fn as_seed(self) -> u8 {
        match self {
            Outcome::Unresolved => 0,
            Outcome::Yes => 1,
            Outcome::No => 2,
            Outcome::Draw => 3,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DuelType {
    OneVOne,
    OneVOneVProtocol,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum DuelStatus {
    Open,
    Active,
    Resolved,
    Cancelled,
}

// --- Ordenes limite de mercados de prediccion (100% on-chain) ---
// Reemplazan al "orderbook" simulado del backend para mercados de prediccion.
// No hay contraparte: una orden limite se ejecuta contra el precio implicito
// del pool del mercado (yes_total/no_total/draw_total sobre pool_total),
// exactamente como hacia matchPredictionOrders() en el backend, pero ahora
// los fondos viven en un escrow on-chain propiedad del programa desde el
// momento en que se crea la orden, nunca en un balance interno custodiado.
// Cualquiera puede disparar execute_prediction_limit_order_* (es un "keeper"
// permissionless, como el crank de cut_off_market): el programa valida la
// condicion de precio on-chain, asi que un keeper malicioso no puede forzar
// un fill a mal precio.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PredictionOrderStatus {
    Open,
    Filled,
    Cancelled,
}

#[account]
pub struct PredictionOrder {
    pub id: u64,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub outcome: Outcome,
    // Monto bruto puesto en el escrow al crear la orden (para LYNX, esto es
    // ANTES del burn de LYNX_EVENT_BURN_BPS, que se aplica en el momento del
    // fill, igual que hacia el backend).
    pub amount: u64,
    // Precio limite como probabilidad implicita en basis points (0..10000).
    // La orden solo se ejecuta cuando el precio implicito ACTUAL del outcome
    // es estrictamente menor que este limite (comprando mas barato de lo
    // pedido). Un mercado con pool_total == 0 nunca cumple la condicion
    // (evita que una orden se auto-rellene en un mercado recien creado sin
    // trading real, igual que excluia el backend).
    pub limit_price_bps: u64,
    pub status: PredictionOrderStatus,
    pub created_ts: i64,
    pub expires_ts: i64,
    pub bump: u8,
    pub escrow_bump: u8,
}

impl PredictionOrder {
    pub const LEN: usize = 8 + 8 + 32 + 32 + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 1;
}

// Escrow en lamports para ordenes limite de mercados en SOL. Simple cuenta
// marcadora (como MarketVault/DuelVault): sus lamports por encima del minimo
// de rent SON el monto depositado por el usuario al crear la orden.
#[account]
pub struct PredictionOrderEscrowSol {
    pub order: Pubkey,
    pub bump: u8,
}

impl PredictionOrderEscrowSol {
    pub const LEN: usize = 8 + 32 + 1;
}

// --- Libro de ordenes LYNX/SOL on-chain (spot, contraparte real) ---
// A diferencia de las ordenes de mercados de prediccion (que se llenan
// contra el pool, sin contraparte), aqui SI hay dos usuarios reales en cada
// fill: un comprador y un vendedor. match_spot_orders() es permissionless
// (cualquiera puede cranquearlo, como el keeper del backend) pero el
// programa valida on-chain que los precios crucen antes de mover un solo
// lamport/micro-LYNX, asi que un keeper no puede forzar un mal fill.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SpotOrderSide {
    Buy,
    Sell,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum SpotOrderStatus {
    Open,
    Filled,
    Cancelled,
}

#[account]
pub struct SpotOrder {
    pub id: u64,
    pub owner: Pubkey,
    pub side: SpotOrderSide,
    // Precio en lamports por micro-LYNX, escalado por PRICE_SCALE (ver
    // constants.rs) para poder representar precios fraccionarios sin usar
    // floats: sol_amount = fill_amount * price_scaled / PRICE_SCALE.
    pub price_scaled: u128,
    // Tamano original de la orden en micro-LYNX (para BUY, esto es cuanto
    // LYNX quiere comprar; para SELL, cuanto LYNX quiere vender).
    pub amount: u64,
    // Cuanto queda sin llenar. Al llegar a 0, status pasa a Filled.
    pub remaining: u64,
    pub status: SpotOrderStatus,
    pub created_ts: i64,
    pub expires_ts: i64,
    pub bump: u8,
    pub escrow_bump: u8,
}

impl SpotOrder {
    pub const LEN: usize = 8 + 8 + 32 + 1 + 16 + 8 + 8 + 1 + 8 + 8 + 1 + 1;
}

// Escrow en lamports para ordenes SpotOrder::Buy (guarda el SOL con el que se
// pagara el LYNX comprado). Mismo patron marcador que PredictionOrderEscrowSol.
#[account]
pub struct SpotOrderEscrowSol {
    pub order: Pubkey,
    pub bump: u8,
}

impl SpotOrderEscrowSol {
    pub const LEN: usize = 8 + 32 + 1;
}

