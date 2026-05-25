$ErrorActionPreference = 'Stop'

$sourceRoot = 'C:\Users\onixm\Documents\Codex\LynxProject-fixes-ready'
$targetRoot = 'C:\Users\onixm\Desktop\LynxProject-mejorado\LynxProject'
$backupRoot = "C:\Users\onixm\Desktop\LynxProject-backup-before-fixes-$(Get-Date -Format 'yyyyMMdd-HHmmss')"

$files = @(
  'AUDIT_REPORT.md',
  'INTEGRATIONS.md',
  'backend\.env.example',
  'backend\src\server.ts',
  'backend\src\state.ts',
  'backend\src\types.ts',
  'backend\tests\api.test.ts',
  'frontend\.env.example',
  'frontend\package.json',
  'frontend\server.ts',
  'frontend\src\App.tsx',
  'frontend\src\constants.ts',
  'frontend\src\types.ts',
  'frontend\src\vite-env.d.ts',
  'frontend\src\components\duels\CreateDuelModal.tsx',
  'frontend\src\components\duels\DuelCard.tsx',
  'frontend\src\components\markets\MarketDetail.tsx',
  'frontend\src\components\orderbook\OrderBookView.tsx',
  'cripto\.gitignore',
  'cripto\programs\lynx_project\src\lib.rs'
)

if (!(Test-Path -LiteralPath $sourceRoot)) {
  throw "Source folder not found: $sourceRoot"
}
if (!(Test-Path -LiteralPath $targetRoot)) {
  throw "Desktop project folder not found: $targetRoot"
}

foreach ($relative in $files) {
  $source = Join-Path $sourceRoot $relative
  $target = Join-Path $targetRoot $relative
  $backup = Join-Path $backupRoot $relative

  if (!(Test-Path -LiteralPath $source)) {
    throw "Missing fixed source file: $source"
  }

  if (Test-Path -LiteralPath $target) {
    $backupDir = Split-Path -Parent $backup
    New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
    Copy-Item -LiteralPath $target -Destination $backup -Force
  }

  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Copy-Item -LiteralPath $source -Destination $target -Force
}

Write-Host "Fixes applied to: $targetRoot"
Write-Host "Backup created at: $backupRoot"
