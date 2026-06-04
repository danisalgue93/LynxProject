-- DropTable: AppState ya no se usa, los datos están en tablas separadas
DROP TABLE IF EXISTS "AppState";

-- CreateTable: Market
CREATE TABLE "Market" (
    "id"               TEXT NOT NULL,
    "title"            TEXT NOT NULL,
    "description"      TEXT NOT NULL,
    "category"         TEXT NOT NULL,
    "imageUrl"         TEXT,
    "status"           TEXT NOT NULL,
    "poolAmount"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "yesAmount"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "noAmount"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "drawAmount"       DOUBLE PRECISION,
    "burnedAmount"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isTernary"        BOOLEAN NOT NULL DEFAULT false,
    "currency"         TEXT NOT NULL,
    "oracleId"         TEXT NOT NULL,
    "oracleMode"       TEXT NOT NULL DEFAULT 'SWITCHBOARD',
    "onChainMarket"    TEXT,
    "onChainSignature" TEXT,
    "createdBy"        TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "cutoffAt"         TIMESTAMP(3) NOT NULL,
    "resolveAt"        TIMESTAMP(3),
    "oracleDeadline"   TIMESTAMP(3),
    "resolvedAt"       TIMESTAMP(3),
    "result"           TEXT,
    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable: UserPosition
CREATE TABLE "UserPosition" (
    "id"         TEXT NOT NULL,
    "marketId"   TEXT NOT NULL,
    "wallet"     TEXT NOT NULL,
    "position"   TEXT NOT NULL,
    "amount"     DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "currency"   TEXT NOT NULL,
    "claimed"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WalletState
CREATE TABLE "WalletState" (
    "wallet"           TEXT NOT NULL,
    "solBalance"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lynxBalance"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stakedLynx"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rewardsSol"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalVolume"      DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wins"             INTEGER NOT NULL DEFAULT 0,
    "losses"           INTEGER NOT NULL DEFAULT 0,
    "approvedAt"       TIMESTAMP(3),
    "approvalNonce"    TEXT,
    "connectedWallets" JSONB,
    CONSTRAINT "WalletState_pkey" PRIMARY KEY ("wallet")
);

-- CreateTable: Order
CREATE TABLE "Order" (
    "id"             TEXT NOT NULL,
    "marketId"       TEXT,
    "pair"           TEXT NOT NULL,
    "owner"          TEXT NOT NULL,
    "side"           TEXT NOT NULL,
    "position"       TEXT,
    "amount"         DOUBLE PRECISION NOT NULL,
    "remaining"      DOUBLE PRECISION NOT NULL,
    "price"          DOUBLE PRECISION NOT NULL,
    "currency"       TEXT NOT NULL,
    "status"         TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "lockedCurrency" TEXT,
    "lockedAmount"   DOUBLE PRECISION,
    "spentAmount"    DOUBLE PRECISION,
    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Trade
CREATE TABLE "Trade" (
    "id"        TEXT NOT NULL,
    "marketId"  TEXT,
    "pair"      TEXT NOT NULL,
    "maker"     TEXT,
    "taker"     TEXT NOT NULL,
    "side"      TEXT NOT NULL,
    "position"  TEXT,
    "amount"    DOUBLE PRECISION NOT NULL,
    "price"     DOUBLE PRECISION NOT NULL,
    "feeAmount" DOUBLE PRECISION NOT NULL,
    "currency"  TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Duel
CREATE TABLE "Duel" (
    "id"             TEXT NOT NULL,
    "parentMarketId" TEXT NOT NULL,
    "creator"        TEXT NOT NULL,
    "rival"          TEXT,
    "amount"         DOUBLE PRECISION NOT NULL,
    "grossAmount"    DOUBLE PRECISION,
    "burnedAmount"   DOUBLE PRECISION,
    "currency"       TEXT NOT NULL,
    "status"         TEXT NOT NULL,
    "positionA"      TEXT NOT NULL,
    "positionB"      TEXT,
    "isTernary"      BOOLEAN,
    "type"           TEXT NOT NULL,
    "protocolSide"   TEXT,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "acceptedAt"     TIMESTAMP(3),
    "resolvedAt"     TIMESTAMP(3),
    "winner"         TEXT,
    CONSTRAINT "Duel_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Proposal
CREATE TABLE "Proposal" (
    "id"          TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status"      TEXT NOT NULL,
    "votesYes"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    "votesNo"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    "endTime"     TEXT NOT NULL,
    "category"    TEXT NOT NULL,
    "author"      TEXT NOT NULL,
    "voters"      JSONB,
    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Notification
CREATE TABLE "Notification" (
    "id"        TEXT NOT NULL,
    "wallet"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "title"     TEXT NOT NULL,
    "message"   TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    "read"      BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Transaction
CREATE TABLE "Transaction" (
    "id"        TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "wallet"    TEXT,
    "intent"    JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LedgerEntry
CREATE TABLE "LedgerEntry" (
    "id"        TEXT NOT NULL,
    "wallet"    TEXT NOT NULL,
    "type"      TEXT NOT NULL,
    "currency"  TEXT,
    "amount"    DOUBLE PRECISION,
    "provider"  TEXT,
    "status"    TEXT NOT NULL,
    "reference" TEXT,
    "metadata"  JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Treasury (singleton, id siempre = 'default')
CREATE TABLE "Treasury" (
    "id"                 TEXT NOT NULL DEFAULT 'default',
    "sol"                DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lynx"               DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lynxForInitialSale" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lynxBurned"         DOUBLE PRECISION NOT NULL DEFAULT 0,
    "protocolDuelSol"    DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "Treasury_pkey" PRIMARY KEY ("id")
);

-- CreateTable: AuthState (sustituye la fila id='auth-users' de AppState)
CREATE TABLE "AuthState" (
    "id"   TEXT NOT NULL,
    "data" JSONB NOT NULL,
    CONSTRAINT "AuthState_pkey" PRIMARY KEY ("id")
);
