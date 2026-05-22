# Use the host IP address directly because localhost:4000 is intercepted by WSL relay on this machine.
$uri = 'http://192.168.1.39:4000'
Write-Output "Using backend URI: $uri"
for ($i=0;$i -lt 20;$i++) {
  try {
    $h = Invoke-RestMethod -Uri ($uri + '/api/health') -Method Get
    if ($h.service -eq 'lynx-backend') { Write-Output 'ready'; break }
  } catch {}
  Start-Sleep -Seconds 1
}
Write-Output 'creating proposal...'
$create = Invoke-RestMethod -Uri ($uri + '/api/proposals') -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{ title='E2E Test Proposal'; description='created by smoke test'; category='test' })
Write-Output 'created:'
$create | ConvertTo-Json -Depth 5 | Write-Output
Write-Output 'listing proposals...'
$props = Invoke-RestMethod -Uri ($uri + '/api/proposals') -Method Get
$props | ConvertTo-Json -Depth 5 | Write-Output
$id = ($props | Where-Object { $_.title -eq 'E2E Test Proposal' } | Select-Object -First 1).id
Write-Output "voting on $id"
Invoke-RestMethod -Uri ($uri + "/api/proposals/$id/vote") -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{ voteType='yes' })
$ts = [math]::Floor((Get-Date).ToUniversalTime().Subtract([datetime]'1970-01-01T00:00:00Z').TotalSeconds)
$signature = "E2E_SIG_$ts"
Write-Output "posting tx $signature"
Invoke-RestMethod -Uri ($uri + '/api/transactions') -Method Post -ContentType 'application/json' -Body (ConvertTo-Json @{ signature=$signature; wallet='DEV_WALLET' })
Write-Output 'transactions list:'
Invoke-RestMethod -Uri ($uri + '/api/transactions') -Method Get | ConvertTo-Json -Depth 5 | Write-Output
