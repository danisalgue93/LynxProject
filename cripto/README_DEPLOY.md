# Deploying `lynx_project` to Devnet

This Anchor workspace targets Devnet by default.

## Build

With the current local toolchain (`anchor-cli 0.30.1`, Rust 1.89), the SBF program builds correctly with:

```bash
anchor build --no-idl
```

`anchor build` without `--no-idl` currently fails inside `anchor-syn 0.30.1` while generating IDL because of a `proc_macro2::Span::source_file` compatibility issue. This is a toolchain/Anchor issue, not a program compile error.

## Deploy

```bash
solana config set --url https://api.devnet.solana.com
solana airdrop 2
npm run build:program
anchor deploy --provider.cluster devnet
```

The program id declared in code and `Anchor.toml` is:

```text
CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu
```

## Initialize Protocol

Because IDL generation is blocked in the current toolchain, the preferred initializer is the manual script:

```bash
npm run init:devnet
```

It does not require an Anchor IDL. It:

- derive the `config` PDA,
- create the LYNX mint with `config` as mint authority,
- create the staking vault token account,
- call `initialize_protocol`.

Useful env vars:

```bash
PROGRAM_ID=CiKuW8r71WnTLkGAKvFyYhtV2UhuJ4j8swDPDc8PEXvu
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com
ANCHOR_WALLET=~/.config/solana/id.json
LYNX_TREASURY=<treasury-wallet>
LYNX_ORACLE_DEADLINE_SECONDS=3600
```

The Anchor migration at `migrations/deploy.ts` is still present for future use once IDL generation is fixed.
