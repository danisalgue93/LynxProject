# Deploy Anchor program to Devnet (PowerShell helper)
# Usage: from repo root run: powershell -ExecutionPolicy Bypass -File .\cripto\deploy_devnet.ps1

Write-Host "1) Ensure you have Solana CLI and Anchor installed and configured."
Write-Host "2) Set your wallet (solana config set --keypair ~/.config/solana/id.json)."
Write-Host "3) This script will switch provider.cluster to 'devnet' in Anchor.toml (creates a backup)."

$anchorToml = "./cripto/Anchor.toml"
$backup = "./cripto/Anchor.toml.bak"
if (Test-Path $anchorToml) {
    Copy-Item $anchorToml $backup -Force
    (Get-Content $anchorToml) -replace 'cluster = "localnet"', 'cluster = "devnet"' | Set-Content $anchorToml
    Write-Host "Updated Anchor.toml -> set cluster=devnet (backup created)."
} else {
    Write-Host "Anchor.toml not found at $anchorToml"
    exit 1
}

Write-Host "Running 'anchor build --no-idl'..."
anchor build --no-idl
if ($LASTEXITCODE -ne 0) { Write-Host "anchor build failed."; exit 1 }

Write-Host "Running 'anchor deploy --provider.cluster devnet'..."
anchor deploy --provider.cluster devnet
if ($LASTEXITCODE -ne 0) { Write-Host "anchor deploy failed."; exit 1 }

Write-Host "Initializing protocol accounts on Devnet..."
Push-Location ./cripto
npm run init:devnet
$initExit = $LASTEXITCODE
Pop-Location
if ($initExit -ne 0) { Write-Host "protocol initialization failed."; exit 1 }

Write-Host "If deploy succeeded, copy the deployed program id into frontend/.env as VITE_LYNX_PROGRAM_ID. Also restore Anchor.toml.bak if you want to revert to localnet."
