# Lynx — Operations Runbook

Procedures for when something is wrong in production. Written to be followed at
3am by whoever is on call, without having to reason from first principles.

**Rule zero: every procedure here must have been rehearsed on staging before it
is needed in production.** An unrehearsed runbook is fiction. See
[Rehearsal log](#rehearsal-log) — a procedure with no rehearsal date has not
been validated and you should expect it to fail.

---

## 0. Contacts and authority

| Role | Who | Reachable at |
|---|---|---|
| On-call engineer | _TBD_ | _TBD_ |
| Admin signer #1 | _TBD_ | _TBD_ |
| Admin signer #2 | _TBD_ | _TBD_ |

Anything that moves funds on-chain needs **both** admin signers (2-of-2
multisig). One person cannot resolve a market, by design. If only one signer is
reachable, the answer is to wait, not to work around it.

---

## 1. Rollback: a bad deploy

**Symptoms:** errors spiking in Sentry after a deploy; health check failing;
users reporting failures that started at deploy time.

**Do not** try to debug forwards in production. Roll back first, diagnose after.

### 1.1 Stop traffic

```bash
# Take the backend out of the load balancer target group.
aws elbv2 deregister-targets --target-group-arn "$TG_ARN" --targets Id="$INSTANCE_ID"
```

Confirm no traffic is arriving before continuing (CloudWatch RequestCount → 0).

### 1.2 Restore the previous version

```bash
# Images are tagged by commit SHA (see .github/workflows/ci.yml).
docker pull ghcr.io/<owner>/lynx-backend:<previous-sha>
docker compose up -d backend
```

### 1.3 Validate the database

**This is the step people skip, and it is the one that matters.** A rolled-back
application against a forward-migrated schema will fail in ways that look like
application bugs.

```bash
# Which migrations are applied?
cd backend && npx prisma migrate status
```

- **If the bad deploy applied no migration:** nothing to do, continue.
- **If it did:** you cannot simply roll the app back. Either
  (a) the migration is backwards-compatible (additive column, new table) and the
      old app ignores it — continue, or
  (b) it is not, and you must restore from the pre-migration backup taken by
      `scripts/pre-migration-backup.sh` (see §2).

There is no third option. Do not guess.

### 1.4 Verify the indexer

The backend indexes on-chain state. After a rollback it may be behind.

```bash
curl -s https://<host>/api/onchain/status | jq
# Expect: { "running": true, "lastSlot": <close to current cluster slot> }
```

If `lastSlot` is far behind, let it catch up before reopening. Serving stale
market state is worse than serving none.

### 1.5 Reopen

```bash
aws elbv2 register-targets --target-group-arn "$TG_ARN" --targets Id="$INSTANCE_ID"
curl -s https://<host>/api/health | jq
```

Watch Sentry for 15 minutes before declaring the incident over.

---

## 2. Restoring the database

Backups are written by `scripts/pre-migration-backup.sh` to `/backups`, and the
five most recent are kept. The migration is blocked if the backup fails — see
that script.

```bash
# 1. Stop traffic (§1.1) and stop the backend so nothing writes during restore.
docker compose stop backend

# 2. Pick the backup. They are named pre_migration_<UTC timestamp>.sql
ls -lt /backups/pre_migration_*.sql | head

# 3. Restore. The dump was taken with --clean --if-exists, so it drops and
#    recreates objects itself.
psql "$DATABASE_URL" -f /backups/pre_migration_<timestamp>.sql

# 4. Confirm the schema matches the app version you are running.
cd backend && npx prisma migrate status

# 5. Restart and verify (§1.4, §1.5).
docker compose up -d backend
```

**A backup you have never restored is not a backup.** Rehearse this on staging
quarterly and record it below.

---

## 3. The TWAP keeper has stopped

**Symptoms:** `record_supply_snapshot` has not been called for over an hour;
keeper alert fired.

**What it means:** the circulating-supply TWAP stops advancing. This is
*fail-safe, not fail-open*: a frozen TWAP cannot be manipulated, it is just
stale. Markets resolving during the outage freeze a mint ratio derived from an
older window.

**Urgency:** high but not an emergency. Do **not** work around it by resolving
markets manually to "unblock" things.

1. Check the keeper service is running and can reach the RPC.
2. Restart it. It is idempotent — the on-chain instruction enforces a
   one-snapshot-per-hour interval, so a burst of retries cannot flood the ring
   buffer.
3. Confirm snapshots resume: the `CirculatingSupplyTwap` account's
   `last_snapshot_ts` should advance.

**If the keeper was down for more than ~24h**, the whole TWAP window is stale.
Let it refill for 24h before resolving any high-value market.

---

## 4. A market cannot be resolved

The oracle should propose the result. Only if it never does — after
`ORACLE_TIMEOUT_SECONDS` past `resolve_ts` — does the admin fallback apply.

**The fallback needs both admins, on their own machines:**

1. Admin #1 opens **their** panel → `propose`.
2. Admin #2 opens **their own** panel → `approve`. This will not work from
   admin #1's panel: the program rejects a second approval from the same key
   (`AlreadyApproved`), and the panel now says so explicitly.
3. Wait out `GOVERNANCE_EXECUTION_DELAY_SECONDS` (the timelock).
4. Either admin → `execute`.

**Never** load both admin keys onto one machine to "speed this up". That
collapses the 2-of-2 into a 1-of-1 and defeats the entire control.

---

## 5. Suspected key compromise

**Admin/multisig signer key:**
1. The multisig is 2-of-2, so one compromised key cannot act alone. Do not panic.
2. Use governance (`RemoveSigner` / `AddSigner`) to rotate the compromised signer
   out — this itself needs both current signers.
3. Rotate the panel's `ADMIN_PASSWORD` and `ADMIN_TOTP_SECRET`.

**Program upgrade authority:**
This is the one that ends the protocol if it leaks — whoever holds it can replace
the program and take everything. It must live in a Squads multisig, never a
single key. If it is compromised, there is no recovery procedure: the correct
prior action was not being in that position.

---

## 6. Exposure limits reached

Markets refuse new positions once configured caps are hit. That is the cap
working, not a bug. Raising it is a **deliberate governance action**, taken when
the protocol has demonstrated stability — never as a reflex to unblock a user.

---

## 7. First-time deployment checklist

Order is load-bearing. Steps 3 and 4 are the ones that are easy to skip and
expensive to skip.

```bash
# 1. Deploy the program (upgrade authority must already be a Squads multisig —
#    a single key here means one compromise replaces the program and takes
#    everything).
anchor deploy --provider.cluster mainnet

# 2. Bootstrap config + LYNX mint + vaults + supply TWAP.
node cripto/scripts/init_protocol.cjs

# 3. Hand governance to the 2-of-2. Until this runs, transfer_admin still works
#    from the single deploy key.
#    init_multisig(signers = [admin1, admin2], threshold = 2)

# 4. START THE TWAP KEEPER AND LEAVE IT RUNNING.
node cripto/scripts/twap_keeper.cjs
```

### Then wait ~24h before resolving anything with real value

The mint ratio comes from the average of 24 hourly circulating-supply samples.
With an empty window the program falls back to the **instantaneous** supply —
the exact reading SC-01 exploited by burning LYNX in the same transaction as a
resolution to jump tier (up to 40x the LYNX owed).

**A market resolving before the window has filled is resolving on a manipulable
ratio.** Confirm before opening markets:

```bash
# CirculatingSupplyTwap.count must equal 24, and last_snapshot_ts must be recent.
solana account <supplyTwap> --output json
```

### Per LYNX market

```
create_market            → the market exists
init_market_lynx_vault   → REQUIRED, or nobody can buy into it
```

This was previously an inline `init_if_needed` inside the buy path, whose codegen
overflowed the BPF stack and made LYNX markets hard-fault at runtime. It is now a
separate one-time call — and it is not optional.

### Launch gates (from the agreed criteria)

- [ ] External audit complete; critical/high findings fixed
- [ ] ≥4 weeks stable on devnet with test users
- [ ] Rollback, restore and keeper procedures **rehearsed** (see log below)
- [ ] Upgrade authority in a Squads multisig
- [ ] TWAP keeper running, monitored, `count == 24`
- [ ] Exposure limits configured
- [ ] Bug bounty live

## Rehearsal log

Record every rehearsal. A procedure that has never been run here is untested.

| Procedure | Last rehearsed | By | Outcome |
|---|---|---|---|
| §1 Rollback of a bad deploy | _never_ | — | **not validated** |
| §2 Database restore | _never_ | — | **not validated** |
| §3 Keeper restart | _never_ | — | **not validated** |
| §4 Admin fallback resolution (2 admins, 2 hosts) | _never_ | — | **not validated** |

**None of these has been rehearsed.** Per the launch criteria, "monitoring,
backups, restore and rollback verified" is a gate — this table is where that gate
is evidenced. Until it has dates in it, that criterion is not met.
