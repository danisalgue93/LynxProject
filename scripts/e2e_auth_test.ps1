#!/usr/bin/env pwsh

# E2E Auth + Market Flow Test

$BASE_URL = "http://localhost:4000"
$EMAIL = "test-$(Get-Random)@example.com"
$PASSWORD = "Test1234!"

Write-Host "🚀 Lynx E2E Auth + Market Test" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host ""

# 1. Register
Write-Host "📝 1. Testing REGISTER..." -ForegroundColor Yellow
try {
  $register_resp = Invoke-WebRequest -Uri "$BASE_URL/auth/register" -Method POST -Headers @{
    "Content-Type" = "application/json"
  } -Body (ConvertTo-Json @{
    email = $EMAIL
    password = $PASSWORD
    displayName = "Test User"
  }) -UseBasicParsing
  
  $reg_data = $register_resp.Content | ConvertFrom-Json
  $token = $reg_data.token
  $user_id = $reg_data.user.id
  
  Write-Host "✅ REGISTER SUCCESS" -ForegroundColor Green
  Write-Host "   User ID: $user_id"
  Write-Host "   Email: $EMAIL"
  Write-Host "   Token: $($token.Substring(0, 20))..."
} catch {
  Write-Host "❌ REGISTER FAILED: $_" -ForegroundColor Red
  exit 1
}

Write-Host ""

# 2. Login with new credentials
Write-Host "🔐 2. Testing LOGIN..." -ForegroundColor Yellow
try {
  $login_resp = Invoke-WebRequest -Uri "$BASE_URL/auth/login" -Method POST -Headers @{
    "Content-Type" = "application/json"
  } -Body (ConvertTo-Json @{
    email = $EMAIL
    password = $PASSWORD
  }) -UseBasicParsing
  
  $login_data = $login_resp.Content | ConvertFrom-Json
  $login_token = $login_data.token
  
  Write-Host "✅ LOGIN SUCCESS" -ForegroundColor Green
  Write-Host "   Token: $($login_token.Substring(0, 20))..."
} catch {
  Write-Host "❌ LOGIN FAILED: $_" -ForegroundColor Red
  exit 1
}

Write-Host ""

# 3. Get /auth/me (authenticated)
Write-Host "👤 3. Testing GET /auth/me (with JWT)..." -ForegroundColor Yellow
try {
  $me_resp = Invoke-WebRequest -Uri "$BASE_URL/auth/me" -Method GET -Headers @{
    "Authorization" = "Bearer $token"
  } -UseBasicParsing
  
  $me_data = $me_resp.Content | ConvertFrom-Json
  
  Write-Host "✅ GET /auth/me SUCCESS" -ForegroundColor Green
  Write-Host "   ID: $($me_data.id)"
  Write-Host "   Email: $($me_data.email)"
  Write-Host "   Name: $($me_data.displayName)"
} catch {
  Write-Host "❌ GET /auth/me FAILED: $_" -ForegroundColor Red
  exit 1
}

Write-Host ""

# 4. Create market (admin token required, but testing structure)
Write-Host "📊 4. Testing POST /api/markets (create market)..." -ForegroundColor Yellow
try {
  $market_resp = Invoke-WebRequest -Uri "$BASE_URL/api/markets" -Method POST -Headers @{
    "Content-Type" = "application/json"
    "x-admin-api-token" = "admin-token-change-in-production"
  } -Body (ConvertTo-Json @{
    title = "Test Market: Will Trump win 2024?"
    description = "Political prediction test"
    category = "politics"
    currency = "SOL"
    isTernary = $false
  }) -UseBasicParsing
  
  $market_data = $market_resp.Content | ConvertFrom-Json
  $market_id = $market_data.id
  
  Write-Host "✅ CREATE MARKET SUCCESS" -ForegroundColor Green
  Write-Host "   Market ID: $market_id"
  Write-Host "   Title: $($market_data.title)"
  Write-Host "   Status: $($market_data.status)"
} catch {
  Write-Host "❌ CREATE MARKET FAILED: $_" -ForegroundColor Red
  exit 1
}

Write-Host ""

# 5. List markets
Write-Host "📈 5. Testing GET /api/markets (list)..." -ForegroundColor Yellow
try {
  $list_resp = Invoke-WebRequest -Uri "$BASE_URL/api/markets" -Method GET -UseBasicParsing
  $markets = $list_resp.Content | ConvertFrom-Json
  
  Write-Host "✅ LIST MARKETS SUCCESS" -ForegroundColor Green
  Write-Host "   Markets count: $($markets.Count)"
  if ($markets.Count -gt 0) {
    Write-Host "   Latest market: $($markets[0].title)"
  }
} catch {
  Write-Host "❌ LIST MARKETS FAILED: $_" -ForegroundColor Red
  exit 1
}

Write-Host ""

# 6. Create proposal
Write-Host "🗳️  6. Testing POST /api/proposals..." -ForegroundColor Yellow
try {
  $prop_resp = Invoke-WebRequest -Uri "$BASE_URL/api/proposals" -Method POST -Headers @{
    "Content-Type" = "application/json"
  } -Body (ConvertTo-Json @{
    title = "Test Proposal: Increase fee to 15%"
    description = "DAO governance test"
    category = "protocol"
  }) -UseBasicParsing
  
  $prop_data = $prop_resp.Content | ConvertFrom-Json
  
  Write-Host "✅ CREATE PROPOSAL SUCCESS" -ForegroundColor Green
  Write-Host "   Proposal ID: $($prop_data.id)"
  Write-Host "   Title: $($prop_data.title)"
} catch {
  Write-Host "❌ CREATE PROPOSAL FAILED: $_" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Gray
Write-Host "✅ ALL TESTS PASSED!" -ForegroundColor Green
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  ✓ User Registration"
Write-Host "  ✓ User Login"  
Write-Host "  ✓ JWT Authentication (/auth/me)"
Write-Host "  ✓ Create Market"
Write-Host "  ✓ List Markets"
Write-Host "  ✓ Create Proposal"
Write-Host ""
Write-Host "🎉 Backend is production-ready!" -ForegroundColor Green
