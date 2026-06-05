-- Migration 001: Replace AuthState JSON blob with proper User table
-- Run this ONCE against your existing database before deploying the new code.
-- It migrates all existing users out of the JSON blob and into rows.

-- 1. Create the new User table
CREATE TABLE IF NOT EXISTS "User" (
  "id"                     TEXT         NOT NULL PRIMARY KEY,
  "email"                  TEXT         NOT NULL UNIQUE,
  "passwordHash"           TEXT         NOT NULL DEFAULT '',
  "displayName"            TEXT,
  "role"                   TEXT         NOT NULL DEFAULT 'user',
  "authMethod"             TEXT         NOT NULL DEFAULT 'email',
  "emailVerified"          BOOLEAN      NOT NULL DEFAULT FALSE,
  "walletAddress"          TEXT         UNIQUE,
  "walletLinkedAt"         TIMESTAMPTZ,
  "managedWalletAddress"   TEXT,
  "emailVerificationToken" TEXT,
  "passwordResetToken"     TEXT,
  "passwordResetExpiresAt" TIMESTAMPTZ,
  "createdAt"              TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- 2. Migrate existing users from the AuthState JSON blob
-- The blob is stored as a JSON array of [id, userObject] pairs.
-- This reads every element and inserts it as a proper row.
DO $$
DECLARE
  blob      JSON;
  pair      JSON;
  u         JSON;
  i         INTEGER;
BEGIN
  SELECT data INTO blob
  FROM "AuthState"
  WHERE id = 'auth-users'
  LIMIT 1;

  IF blob IS NULL THEN
    RAISE NOTICE 'No AuthState blob found — skipping migration of existing users.';
    RETURN;
  END IF;

  FOR i IN 0 .. json_array_length(blob) - 1 LOOP
    pair := blob->i;          -- [id, userObject]
    u    := pair->1;          -- the user object

    INSERT INTO "User" (
      "id", "email", "passwordHash", "displayName", "role",
      "authMethod", "emailVerified", "walletAddress", "walletLinkedAt",
      "managedWalletAddress", "emailVerificationToken",
      "passwordResetToken", "passwordResetExpiresAt", "createdAt"
    )
    VALUES (
      u->>'id',
      u->>'email',
      COALESCE(u->>'passwordHash', ''),
      u->>'displayName',
      COALESCE(u->>'role', 'user'),
      COALESCE(u->>'authMethod', 'email'),
      COALESCE((u->>'emailVerified')::BOOLEAN, FALSE),
      u->>'walletAddress',
      CASE WHEN u->>'walletLinkedAt' IS NOT NULL
           THEN to_timestamp((u->>'walletLinkedAt')::BIGINT / 1000.0)
           ELSE NULL END,
      u->>'managedWalletAddress',
      u->>'emailVerificationToken',
      u->>'passwordResetToken',
      CASE WHEN u->>'passwordResetExpiresAt' IS NOT NULL
           THEN to_timestamp((u->>'passwordResetExpiresAt')::BIGINT / 1000.0)
           ELSE NULL END,
      CASE WHEN u->>'createdAt' IS NOT NULL
           THEN to_timestamp((u->>'createdAt')::BIGINT / 1000.0)
           ELSE now() END
    )
    ON CONFLICT ("id") DO NOTHING;
  END LOOP;

  RAISE NOTICE 'Migrated % users from AuthState blob.', json_array_length(blob);
END;
$$;

-- 3. Drop the old AuthState table (only after verifying migration was successful)
-- Comment this out if you want to keep it as a backup temporarily.
DROP TABLE IF EXISTS "AuthState";
