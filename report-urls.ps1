# Prints LAN and public-tunnel access URLs for the SES EHR stack.
# Called by start-all.bat after services and tunnels have had time to boot.
param(
    [string]$LogDir = "$PSScriptRoot\.tunnel-logs"
)

$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.InterfaceAlias -notmatch 'Loopback' -and
    $_.IPAddress -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)'
} | Select-Object -First 1).IPAddress

Write-Host ''
Write-Host '==================== ACCESS URLS ===================='
Write-Host ''
Write-Host 'LAN (same WiFi):'
if ($ip) {
    Write-Host "  Staff client:   http://$ip`:5173"
    Write-Host "  Patient portal: http://$ip`:5175"
} else {
    Write-Host '  Could not detect a LAN IP automatically - run ipconfig to find it.'
}

Write-Host ''
Write-Host 'Public tunnel (any network - changes every run):'

function Get-TunnelUrl($logFile) {
    if (-not (Test-Path $logFile)) { return $null }
    $match = Select-String -Path $logFile -Pattern 'https://[a-zA-Z0-9.-]*\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($match) { return $match.Matches[0].Value }
    return $null
}

$clientUrl = Get-TunnelUrl "$LogDir\client.log"
$portalUrl = Get-TunnelUrl "$LogDir\portal.log"

if ($clientUrl) { Write-Host "  Staff client:   $clientUrl" } else { Write-Host '  Staff client:   (not ready yet - check its tunnel window)' }
if ($portalUrl) { Write-Host "  Patient portal: $portalUrl" } else { Write-Host '  Patient portal: (not ready yet - check its tunnel window)' }

Write-Host ''
Write-Host '======================================================='
