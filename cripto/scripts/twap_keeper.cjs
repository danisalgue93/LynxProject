/**
 * Circulating-supply TWAP keeper.
 *
 * Calls record_supply_snapshot once per hour. The mint ratio for resolving SOL
 * markets is derived from the average of the last SUPPLY_SNAPSHOT_COUNT (24)
 * hourly samples rather than the instantaneous circulating supply — that is what
 * closes SC-01, where an attacker burned LYNX in the same transaction as a
 * resolution to jump tier and mint up to 40x the LYNX they were owed.
 *
 * The on-chain instruction is permissionless and reads the supply itself from
 * ProtocolConfig, so this keeper has no discretion over the value it records —
 * only over *when*. It cannot manipulate the TWAP; it can only fail to advance
 * it. That failure is fail-safe (a stale TWAP is not a manipulable one) but it
 * still degrades the protocol, so it must be monitored.
 *
 * Run it as a service (systemd / ECS task / k8s Deployment), not by hand.
 *
 * Env:
 *   PROGRAM_ID, ANCHOR_PROVIDER_URL | SOLANA_RPC_URL
 *   KEEPER_KEYPAIR       path to the keypair that pays the (tiny) tx fees
 *   HEALTHCHECK_URL      optional: pinged after every successful snapshot, so a
 *                        dead-man's-switch (Healthchecks.io, Better Uptime, a
 *                        CloudWatch canary) alerts if snapshots stop
 *   SNAPSHOT_INTERVAL_MS optional override, default 1h — must be >= the on-chain
 *                        SUPPLY_SNAPSHOT_INTERVAL_SECONDS or calls are rejected
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu',
);
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

// Matches SUPPLY_SNAPSHOT_INTERVAL_SECONDS on-chain. Going faster is pointless:
// the program rejects a snapshot inside the interval (SnapshotTooSoon), which is
// deliberate — without that rate limit an attacker could fill all 24 slots with
// a manipulated supply in one transaction and defeat the average entirely.
const SNAPSHOT_INTERVAL_MS = Number(process.env.SNAPSHOT_INTERVAL_MS || 60 * 60 * 1000);

// Retry a failed snapshot rather than waiting a whole hour for the next tick: a
// transient RPC error should not cost a sample.
const RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 300_000];

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function loadKeypair() {
  const walletPath = expandHome(
    process.env.KEEPER_KEYPAIR || process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json'),
  );
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf8'))));
}

function anchorDiscriminator(name) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

/** One structured JSON line per event — picked up by CloudWatch, queryable, alertable. */
function log(level, event, fields = {}) {
  console.log(JSON.stringify({ level, event, at: new Date().toISOString(), ...fields }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pingHealthcheck(ok) {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  try {
    // A dead-man's switch: if these stop arriving, the monitor pages someone.
    // That is the alert that matters — nobody notices a keeper that is merely
    // quiet, and a frozen TWAP is silent by nature.
    await fetch(ok ? url : `${url}/fail`, { method: 'POST' });
  } catch (err) {
    log('warn', 'healthcheck.failed', { error: err?.message });
  }
}

async function recordSnapshot(connection, payer, config, supplyTwap) {
  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: supplyTwap, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(anchorDiscriminator('record_supply_snapshot')),
  });
  const tx = new Transaction().add(ix);
  tx.feePayer = payer.publicKey;
  return sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
}

async function snapshotWithRetries(connection, payer, config, supplyTwap) {
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const signature = await recordSnapshot(connection, payer, config, supplyTwap);
      log('info', 'snapshot.recorded', { signature, attempt });
      await pingHealthcheck(true);
      return true;
    } catch (err) {
      const message = err?.message ?? String(err);

      // Being early is not an error: it means someone (a redundant keeper, a
      // manual run) already recorded this window. Treat it as success so a
      // second instance does not spam alerts.
      if (message.includes('SnapshotTooSoon') || message.includes('0x1794')) {
        log('info', 'snapshot.already_recorded_this_window', {});
        await pingHealthcheck(true);
        return true;
      }

      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) {
        log('error', 'snapshot.failed_permanently', { error: message, attempts: attempt + 1 });
        await pingHealthcheck(false);
        return false;
      }
      log('warn', 'snapshot.retrying', { error: message, attempt, retryInMs: delay });
      await sleep(delay);
    }
  }
  return false;
}

async function main() {
  const payer = loadKeypair();
  const connection = new Connection(RPC_URL, 'confirmed');
  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  const [supplyTwap] = PublicKey.findProgramAddressSync(
    [Buffer.from('supply_twap'), config.toBuffer()],
    PROGRAM_ID,
  );

  // Fail fast on a misconfiguration rather than looping silently: a keeper that
  // logs an error every hour and never records anything looks alive on a
  // dashboard while the TWAP quietly goes stale.
  const twapAccount = await connection.getAccountInfo(supplyTwap);
  if (!twapAccount) {
    log('error', 'startup.twap_not_initialized', { supplyTwap: supplyTwap.toBase58() });
    console.error('\nThe supply TWAP account does not exist. Run scripts/init_protocol.cjs first.');
    process.exit(1);
  }

  const balance = await connection.getBalance(payer.publicKey);
  if (balance === 0) {
    log('error', 'startup.keeper_unfunded', { keeper: payer.publicKey.toBase58() });
    console.error('\nThe keeper wallet has no SOL and cannot pay transaction fees.');
    process.exit(1);
  }

  log('info', 'keeper.started', {
    keeper: payer.publicKey.toBase58(),
    programId: PROGRAM_ID.toBase58(),
    supplyTwap: supplyTwap.toBase58(),
    intervalMs: SNAPSHOT_INTERVAL_MS,
    rpc: RPC_URL,
    healthcheck: process.env.HEALTHCHECK_URL ? 'configured' : 'NOT CONFIGURED — no alert if this stops',
  });

  let running = true;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      log('info', 'keeper.stopping', { signal });
      running = false;
      process.exit(0);
    });
  }

  // Take one immediately so a restart does not leave an hour-long hole.
  await snapshotWithRetries(connection, payer, config, supplyTwap);

  while (running) {
    await sleep(SNAPSHOT_INTERVAL_MS);
    if (!running) break;
    await snapshotWithRetries(connection, payer, config, supplyTwap);
  }
}

main().catch((error) => {
  log('error', 'keeper.crashed', { error: error?.message ?? String(error) });
  process.exit(1);
});
