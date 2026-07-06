-- Migration: LedgerType enum existed in the schema but was never applied to
-- any column — LedgerEntry.type was a free String, and the app already wrote
-- values ('TRADE', 'SETTLEMENT', 'EMISSION', 'BURN', 'REFUND' — see
-- LedgerEntry['type'] in backend/src/types.ts) that weren't in the enum.
-- Add the missing values, then bind the column to the enum for real.
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'TRADE';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'SETTLEMENT';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'EMISSION';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'BURN';
ALTER TYPE "LedgerType" ADD VALUE IF NOT EXISTS 'REFUND';

-- AlterTable
ALTER TABLE "LedgerEntry" ALTER COLUMN "type" TYPE "LedgerType" USING ("type"::"LedgerType");
