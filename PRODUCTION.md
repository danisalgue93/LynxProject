# Lynx Production Path

Lynx esta planteado como dApp sin backend. La fuente de verdad es el programa Anchor en Solana y el frontend habla directamente con RPC + wallet.

## 1. Instalar entorno Solana

En Windows usa WSL con Ubuntu. Despues, dentro de Ubuntu:

```bash
curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash
```

Reabre la terminal y verifica:

```bash
rustc --version
cargo --version
solana --version
anchor --version
node --version
yarn --version
```

## 2. Compilar contrato

```bash
cd cripto
anchor build
```

Si Anchor genera un program id diferente, actualiza:

- `cripto/Anchor.toml`
- `cripto/programs/lynx_protocol/src/lib.rs`
- `frontend/.env.local`

## 3. Probar localnet

Terminal A:

```bash
solana-test-validator
```

Terminal B:

```bash
cd cripto
solana config set --url localhost
anchor deploy
anchor test
```

## 4. Conectar frontend a localnet

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

`.env.local`:

```bash
VITE_SOLANA_RPC_URL=http://127.0.0.1:8899
VITE_LYNX_PROGRAM_ID=7hPfrAwhNPJ6Xt7Y3ximBog1EdzfJV31VBTnYQxLRYCy
```

## 5. Devnet

```bash
solana config set --url devnet
solana airdrop 2
cd cripto
anchor deploy --provider.cluster devnet
```

Frontend:

```bash
VITE_SOLANA_RPC_URL=https://api.devnet.solana.com
VITE_LYNX_PROGRAM_ID=<PROGRAM_ID_DESPLEGADO>
```

## 6. Mainnet

Antes de mainnet con fondos reales:

- tests de integracion completos
- fuzz/property tests para settlement y payouts
- oracle Switchboard integrado
- admin fallback con multisig + timelock
- auditoria externa
- bug bounty privado o publico
- RPC dedicado, no endpoint publico gratuito

## 7. Web production

```bash
cd frontend
npm run build
```

Despliega `frontend/dist` en Vercel, Netlify, Cloudflare Pages o hosting estatico equivalente.
