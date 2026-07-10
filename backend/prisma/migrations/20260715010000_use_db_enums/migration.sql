-- BE-16: Convert String columns to proper enum types where defined enums exist.
-- Market
ALTER TABLE "Market" ALTER COLUMN "status" TYPE "MarketStatus" USING "status"::"MarketStatus";
ALTER TABLE "Market" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
-- UserPosition
ALTER TABLE "UserPosition" ALTER COLUMN "position" TYPE "Position" USING "position"::"Position";
ALTER TABLE "UserPosition" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
-- Order
ALTER TABLE "Order" ALTER COLUMN "side" TYPE "OrderSide" USING "side"::"OrderSide";
ALTER TABLE "Order" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
ALTER TABLE "Order" ALTER COLUMN "status" TYPE "OrderStatus" USING "status"::"OrderStatus";
-- Trade
ALTER TABLE "Trade" ALTER COLUMN "side" TYPE "OrderSide" USING "side"::"OrderSide";
ALTER TABLE "Trade" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
-- Duel
ALTER TABLE "Duel" ALTER COLUMN "currency" TYPE "Currency" USING "currency"::"Currency";
ALTER TABLE "Duel" ALTER COLUMN "status" TYPE "DuelStatus" USING "status"::"DuelStatus";
-- Proposal
ALTER TABLE "Proposal" ALTER COLUMN "status" TYPE "ProposalStatus" USING "status"::"ProposalStatus";
ALTER TABLE "Proposal" ALTER COLUMN "category" TYPE "ProposalCategory" USING "category"::"ProposalCategory";