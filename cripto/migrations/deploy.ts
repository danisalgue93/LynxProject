import * as anchor from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from '@solana/web3.js';

module.exports = async function (provider: anchor.AnchorProvider) {
  anchor.setProvider(provider);

  const program = anchor.workspace.LynxProject;
  const admin = provider.wallet.publicKey;
  const treasury = process.env.LYNX_TREASURY
    ? new PublicKey(process.env.LYNX_TREASURY)
    : admin;

  const [config] = PublicKey.findProgramAddressSync([Buffer.from('config')], program.programId);
  const [rewardsVault] = PublicKey.findProgramAddressSync([Buffer.from('rewards_vault')], program.programId);

  const existingConfig = await provider.connection.getAccountInfo(config);
  if (existingConfig) {
    console.log('Lynx protocol already initialized');
    console.log('config:', config.toBase58());
    return;
  }

  const payer = (provider.wallet as anchor.Wallet).payer;
  if (!payer) {
    throw new Error('Provider wallet must expose payer Keypair for migration initialization');
  }

  const lynxMint = await createMint(
    provider.connection,
    payer,
    config,
    config,
    6,
  );

  const stakeVault = await getOrCreateAssociatedTokenAccount(
    provider.connection,
    payer,
    lynxMint,
    config,
    true,
  );

  const signature = await program.methods
    .initializeProtocol(new anchor.BN(3_600))
    .accounts({
      config,
      lynxMint,
      stakeVault: stakeVault.address,
      rewardsVault,
      admin,
      treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  console.log('Lynx protocol initialized');
  console.log('tx:', signature);
  console.log('config:', config.toBase58());
  console.log('lynxMint:', lynxMint.toBase58());
  console.log('stakeVault:', stakeVault.address.toBase58());
  console.log('rewardsVault:', rewardsVault.toBase58());
};
