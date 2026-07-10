-- Fix BE-04: Reset any WalletState rows that still have the old insecure defaults.
-- New rows already default to 0 via the schema; this handles existing data.
UPDATE "WalletState" SET "solBalance" = 0 WHERE "solBalance" = 100;
UPDATE "WalletState" SET "lynxBalance" = 0 WHERE "lynxBalance" = 10000;