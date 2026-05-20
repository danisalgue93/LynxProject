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
const ORACLE_DEADLINE_SECONDS = BigInt(process.env.LYNX_ORACLE_DEADLINE_SECONDS || '3600');

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

async function main() {
  const payer = loadKeypair();
  const connection = new Connection(RPC_URL, 'confirmed');
  const treasury = new PublicKey(process.env.LYNX_TREASURY || payer.publicKey.toBase58());

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
  const [rewardsVault] = PublicKey.findProgramAddressSync([Buffer.from('rewards_vault')], PROGRAM_ID);

  const existing = await connection.getAccountInfo(config);
  if (existing) {
    console.log('Lynx protocol already initialized');
    console.log('config:', config.toBase58());
    return;
  }

  const lynxMint = await createMint(connection, payer, config, config, 6);
  const stakeVault = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    lynxMint,
    config,
    true,
  );

  const data = Buffer.alloc(16);
  anchorDiscriminator('initialize_protocol').copy(data, 0);
  data.writeBigUInt64LE(ORACLE_DEADLINE_SECONDS, 8);

  const initializeProtocol = new TransactionInstruction({
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

  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(initializeProtocol),
    [payer],
    { commitment: 'confirmed' },
  );

  console.log('Lynx protocol initialized');
  console.log('tx:', signature);
  console.log('programId:', PROGRAM_ID.toBase58());
  console.log('config:', config.toBase58());
  console.log('lynxMint:', lynxMint.toBase58());
  console.log('stakeVault:', stakeVault.address.toBase58());
  console.log('rewardsVault:', rewardsVault.toBase58());
  console.log('treasury:', treasury.toBase58());
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
