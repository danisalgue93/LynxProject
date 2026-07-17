/**
 * One-time protocol bootstrap.
 *
 * Order matters and each step is required before the protocol is usable:
 *   1. initialize_protocol  — creates ProtocolConfig, the LYNX mint, the vaults
 *   2. init_supply_twap     — creates the circulating-supply ring buffer
 *   3. init_multisig        — hands governance to the 2-of-2 (run separately,
 *                             it needs both admins' pubkeys)
 *
 * After this, and BEFORE any market with real value resolves:
 *   - Run the TWAP keeper for ~24h so the window fills with honest samples
 *     (scripts/twap_keeper.cjs). Until it has samples, the mint ratio falls back
 *     to the instantaneous circulating supply, which is the exact manipulation
 *     SC-01 was about.
 *   - Call init_market_lynx_vault once per LYNX-denominated market, right after
 *     create_market. LYNX markets cannot be bought into until it exists.
 *
 * Env:
 *   PROGRAM_ID, ANCHOR_PROVIDER_URL | SOLANA_RPC_URL, ANCHOR_WALLET, LYNX_TREASURY
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash } = require('crypto');
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} = require('@solana/spl-token');

const PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || 'CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu',
);
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

function expandHome(filePath) {
  if (!filePath.startsWith('~')) return filePath;
  return path.join(os.homedir(), filePath.slice(1));
}

function loadKeypair() {
  const walletPath = expandHome(process.env.ANCHOR_WALLET || path.join(os.homedir(), '.config/solana/id.json'));
  const secret = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

function anchorDiscriminator(name) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

async function initializeProtocol(connection, payer, config, rewardsVault, treasury) {
  const existing = await connection.getAccountInfo(config);
  if (existing) {
    console.log('[1/2] protocol already initialized —', config.toBase58());
    return null;
  }

  const lynxMint = await createMint(connection, payer, config, config, 6);
  const stakeVault = await getOrCreateAssociatedTokenAccount(connection, payer, lynxMint, config, true);

  // NOTE: initialize_protocol takes NO instruction arguments — only the 8-byte
  // discriminator. This script used to append an 8-byte ORACLE_DEADLINE_SECONDS,
  // left over from a version of the program that had an `emergency_delay` field.
  // That field no longer exists (the same ghost that made the admin panel's
  // decodeConfig read 8 bytes out of alignment). Sending arguments the program
  // does not declare is at best ignored and at worst a decode failure.
  const data = Buffer.from(anchorDiscriminator('initialize_protocol'));

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: lynxMint, isSigner: false, isWritable: true },
      { pubkey: stakeVault.address, isSigner: false, isWritable: true },
      { pubkey: rewardsVault, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: treasury, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });

  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
    commitment: 'confirmed',
  });
  console.log('[1/2] protocol initialized — tx', signature);
  return { lynxMint, stakeVault: stakeVault.address };
}

async function initSupplyTwap(connection, payer, config) {
  const [supplyTwap] = PublicKey.findProgramAddressSync(
    [Buffer.from('supply_twap'), config.toBuffer()],
    PROGRAM_ID,
  );

  const existing = await connection.getAccountInfo(supplyTwap);
  if (existing) {
    console.log('[2/2] supply TWAP already initialized —', supplyTwap.toBase58());
    return supplyTwap;
  }

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: supplyTwap, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(anchorDiscriminator('init_supply_twap')),
  });

  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [payer], {
    commitment: 'confirmed',
  });
  console.log('[2/2] supply TWAP initialized — tx', signature);
  return supplyTwap;
}

async function main() {
  const payer = loadKeypair();
  const connection = new Connection(RPC_URL, 'confirmed');
  const treasury = new PublicKey(process.env.LYNX_TREASURY || payer.publicKey.toBase58());

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  const [rewardsVault] = PublicKey.findProgramAddressSync([Buffer.from('rewards_vault')], PROGRAM_ID);

  const created = await initializeProtocol(connection, payer, config, rewardsVault, treasury);
  const supplyTwap = await initSupplyTwap(connection, payer, config);

  console.log('\n─── addresses ───');
  console.log('programId   :', PROGRAM_ID.toBase58());
  console.log('config      :', config.toBase58());
  console.log('rewardsVault:', rewardsVault.toBase58());
  console.log('supplyTwap  :', supplyTwap.toBase58());
  console.log('treasury    :', treasury.toBase58());
  if (created) {
    console.log('lynxMint    :', created.lynxMint.toBase58());
    console.log('stakeVault  :', created.stakeVault.toBase58());
  }

  console.log('\n─── required next steps ───');
  console.log('1. init_multisig with BOTH admin pubkeys (threshold 2).');
  console.log('   Until then transfer_admin still works from this single key.');
  console.log('2. Start the TWAP keeper NOW and leave it running:');
  console.log('     node scripts/twap_keeper.cjs');
  console.log('   Let it collect ~24h of samples before any market with real');
  console.log('   value resolves — an empty window falls back to the');
  console.log('   instantaneous supply, which is manipulable (SC-01).');
  console.log('3. For each LYNX market: call init_market_lynx_vault after');
  console.log('   create_market, or nobody can buy into it.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
