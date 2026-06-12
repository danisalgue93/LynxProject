/*
  Warnings:

  - You are about to alter the column `amount` on the `Duel` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `grossAmount` on the `Duel` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `burnedAmount` on the `Duel` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `amount` on the `LedgerEntry` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `poolAmount` on the `Market` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `yesAmount` on the `Market` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `noAmount` on the `Market` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `drawAmount` on the `Market` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `burnedAmount` on the `Market` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `amount` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `remaining` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `price` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `lockedAmount` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `spentAmount` on the `Order` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `votesYes` on the `Proposal` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `votesNo` on the `Proposal` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `amount` on the `Trade` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `price` on the `Trade` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `feeAmount` on the `Trade` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `sol` on the `Treasury` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `lynx` on the `Treasury` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `lynxForInitialSale` on the `Treasury` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `lynxBurned` on the `Treasury` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `protocolDuelSol` on the `Treasury` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `amount` on the `UserPosition` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `entryPrice` on the `UserPosition` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `solBalance` on the `WalletState` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `lynxBalance` on the `WalletState` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `stakedLynx` on the `WalletState` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `rewardsSol` on the `WalletState` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to alter the column `totalVolume` on the `WalletState` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(28,9)`.
  - You are about to drop the `AuthState` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[signature]` on the table `Transaction` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `WalletState` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('OPEN', 'ACTIVE', 'CUT_OFF', 'RESOLVED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('YES', 'NO', 'A', 'B', 'DRAW');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('SOL', 'LYNX', 'USD');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('OPEN', 'PARTIAL_FILLED', 'FILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DuelStatus" AS ENUM ('OPEN', 'ACCEPTED', 'RESOLVED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('ACTIVE', 'PASSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProposalCategory" AS ENUM ('PROTOCOL', 'MARKETS', 'FEES', 'COMMUNITY');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('DEPOSIT', 'WITHDRAWAL', 'TRADE_BUY', 'TRADE_SELL', 'SETTLEMENT_WIN', 'SETTLEMENT_LOSS', 'FEE', 'REWARD', 'STAKE', 'UNSTAKE', 'APPROVE');

-- AlterTable
ALTER TABLE "Duel" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "grossAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "burnedAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "status" SET DEFAULT 'OPEN',
ALTER COLUMN "type" SET DEFAULT '1v1';

-- AlterTable
ALTER TABLE "LedgerEntry" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(28,9);

-- AlterTable
ALTER TABLE "Market" ALTER COLUMN "status" SET DEFAULT 'OPEN',
ALTER COLUMN "poolAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "yesAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "noAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "drawAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "burnedAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "currency" SET DEFAULT 'SOL',
ALTER COLUMN "oracleId" DROP NOT NULL,
ALTER COLUMN "oracleMode" SET DEFAULT 'MANUAL_DEV';

-- AlterTable
ALTER TABLE "Order" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "remaining" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "price" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "status" SET DEFAULT 'OPEN',
ALTER COLUMN "lockedAmount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "spentAmount" SET DATA TYPE DECIMAL(28,9);

-- AlterTable
ALTER TABLE "Proposal" ALTER COLUMN "status" SET DEFAULT 'active',
ALTER COLUMN "votesYes" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "votesNo" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "category" SET DEFAULT 'community';

-- AlterTable
ALTER TABLE "Trade" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "price" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "feeAmount" SET DEFAULT 0,
ALTER COLUMN "feeAmount" SET DATA TYPE DECIMAL(28,9);

-- AlterTable
ALTER TABLE "Treasury" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "sol" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "lynx" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "lynxForInitialSale" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "lynxBurned" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "protocolDuelSol" SET DATA TYPE DECIMAL(28,9);

-- AlterTable
ALTER TABLE "UserPosition" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "entryPrice" SET DEFAULT 1,
ALTER COLUMN "entryPrice" SET DATA TYPE DECIMAL(28,9);

-- AlterTable
ALTER TABLE "WalletState" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "solBalance" SET DEFAULT 100,
ALTER COLUMN "solBalance" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "lynxBalance" SET DEFAULT 10000,
ALTER COLUMN "lynxBalance" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "stakedLynx" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "rewardsSol" SET DATA TYPE DECIMAL(28,9),
ALTER COLUMN "totalVolume" SET DATA TYPE DECIMAL(28,9);

-- DropTable
DROP TABLE "AuthState";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL DEFAULT '',
    "displayName" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "authMethod" TEXT NOT NULL DEFAULT 'email',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "walletAddress" TEXT,
    "walletLinkedAt" TIMESTAMP(3),
    "managedWalletAddress" TEXT,
    "emailVerificationToken" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalVote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "wallet" TEXT NOT NULL,
    "voteType" TEXT NOT NULL,
    "weight" DECIMAL(28,9) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candle" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "marketId" TEXT,
    "time" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(28,9) NOT NULL,
    "high" DECIMAL(28,9) NOT NULL,
    "low" DECIMAL(28,9) NOT NULL,
    "close" DECIMAL(28,9) NOT NULL,
    "volume" DECIMAL(28,9) NOT NULL,

    CONSTRAINT "Candle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "User_walletAddress_idx" ON "User"("walletAddress");

-- CreateIndex
CREATE INDEX "ProposalVote_proposalId_idx" ON "ProposalVote"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalVote_proposalId_wallet_key" ON "ProposalVote"("proposalId", "wallet");

-- CreateIndex
CREATE INDEX "Candle_symbol_interval_idx" ON "Candle"("symbol", "interval");

-- CreateIndex
CREATE INDEX "Candle_marketId_idx" ON "Candle"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "Candle_symbol_interval_time_key" ON "Candle"("symbol", "interval", "time");

-- CreateIndex
CREATE INDEX "Duel_parentMarketId_idx" ON "Duel"("parentMarketId");

-- CreateIndex
CREATE INDEX "Duel_status_idx" ON "Duel"("status");

-- CreateIndex
CREATE INDEX "Duel_creator_idx" ON "Duel"("creator");

-- CreateIndex
CREATE INDEX "LedgerEntry_wallet_idx" ON "LedgerEntry"("wallet");

-- CreateIndex
CREATE INDEX "LedgerEntry_type_idx" ON "LedgerEntry"("type");

-- CreateIndex
CREATE INDEX "LedgerEntry_createdAt_idx" ON "LedgerEntry"("createdAt");

-- CreateIndex
CREATE INDEX "Market_status_idx" ON "Market"("status");

-- CreateIndex
CREATE INDEX "Market_cutoffAt_idx" ON "Market"("cutoffAt");

-- CreateIndex
CREATE INDEX "Market_currency_idx" ON "Market"("currency");

-- CreateIndex
CREATE INDEX "Notification_wallet_read_idx" ON "Notification"("wallet", "read");

-- CreateIndex
CREATE INDEX "Notification_timestamp_idx" ON "Notification"("timestamp");

-- CreateIndex
CREATE INDEX "Order_pair_status_idx" ON "Order"("pair", "status");

-- CreateIndex
CREATE INDEX "Order_marketId_idx" ON "Order"("marketId");

-- CreateIndex
CREATE INDEX "Order_owner_idx" ON "Order"("owner");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Trade_pair_idx" ON "Trade"("pair");

-- CreateIndex
CREATE INDEX "Trade_taker_idx" ON "Trade"("taker");

-- CreateIndex
CREATE INDEX "Trade_marketId_idx" ON "Trade"("marketId");

-- CreateIndex
CREATE INDEX "Trade_createdAt_idx" ON "Trade"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_signature_key" ON "Transaction"("signature");

-- CreateIndex
CREATE INDEX "Transaction_wallet_idx" ON "Transaction"("wallet");

-- CreateIndex
CREATE INDEX "Transaction_timestamp_idx" ON "Transaction"("timestamp");

-- CreateIndex
CREATE INDEX "UserPosition_wallet_idx" ON "UserPosition"("wallet");

-- CreateIndex
CREATE INDEX "UserPosition_marketId_idx" ON "UserPosition"("marketId");

-- CreateIndex
CREATE INDEX "WalletState_approvedAt_idx" ON "WalletState"("approvedAt");

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Duel" ADD CONSTRAINT "Duel_parentMarketId_fkey" FOREIGN KEY ("parentMarketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalVote" ADD CONSTRAINT "ProposalVote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candle" ADD CONSTRAINT "Candle_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE SET NULL ON UPDATE CASCADE;
