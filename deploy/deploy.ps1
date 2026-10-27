<#
  Uploads the project to the server and (re)starts it with Docker Compose + Caddy (HTTPS).

  First deploy:   .\deploy\deploy.ps1 -Server ubuntu@1.2.3.4 -Domain deadlockpapi.duckdns.org
  Steam login:    .\deploy\deploy.ps1 -Server ubuntu@1.2.3.4 -Domain deadlockpapi.duckdns.org -SteamLogin
  Logs:           ssh -i $HOME\.ssh\papi_server ubuntu@1.2.3.4 "cd /opt/papi && sudo docker compose logs -f worker"
#>
param(
  [Parameter(Mandatory)] [string]$Server,
  [Parameter(Mandatory)] [string]$Domain,
  [string]$Key = "$HOME\.ssh\papi_server",
  [string]$RemoteDir = '/opt/papi',
  [switch]$SteamLogin
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ssh = @('-i', $Key, '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30')

if ($SteamLogin) {
  # Interactive: you type the bot's Steam password and Steam Guard code yourself.
  ssh -t @ssh $Server "cd $RemoteDir && sudo docker compose run --rm -it worker node_modules/.bin/tsx scripts/steam-login.ts && sudo docker compose restart worker"
  exit $LASTEXITCODE
}

Push-Location $root
try {
  if (-not (Test-Path .env)) { throw '.env not found in the project folder' }

  # Production overrides on top of the local .env (admin password hash etc. are kept).
  $envText = [IO.File]::ReadAllText((Join-Path $root '.env'))
  $overrides = [ordered]@{
    NODE_ENV         = 'production'
    DOMAIN           = $Domain
    COOKIE_SECURE    = 'true'
    DATABASE_URL     = 'file:/data/app.db'
    STEAM_TOKEN_FILE = '/data/steam-refresh-token.txt'
  }
  foreach ($k in $overrides.Keys) {
    $line = "$k=$($overrides[$k])"
    if ($envText -match "(?m)^$k=") { $envText = $envText -replace "(?m)^$k=.*$", $line }
    else { $envText = $envText.TrimEnd() + "`n$line`n" }
  }
  if ($envText -match '(?m)^INVITE_PROVIDER=mock') { throw 'INVITE_PROVIDER=mock is not allowed in production' }

  $tmp = Join-Path $env:TEMP 'papi-deploy'
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory $tmp | Out-Null
  [IO.File]::WriteAllText("$tmp\app.env", $envText.Replace("`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))
  $setup = [IO.File]::ReadAllText((Join-Path $root 'deploy\setup-server.sh')).Replace("`r`n", "`n")
  [IO.File]::WriteAllText("$tmp\setup-server.sh", $setup, (New-Object Text.UTF8Encoding($false)))

  Write-Host '==> Packing project'
  tar -czf "$tmp\app.tgz" --exclude=node_modules --exclude=.next --exclude=data --exclude=.env --exclude=.git --exclude=.claude --exclude=*.tsbuildinfo .
  if ($LASTEXITCODE -ne 0) { throw 'tar failed' }

  Write-Host "==> Uploading to $Server"
  scp @ssh "$tmp\app.tgz" "$tmp\app.env" "$tmp\setup-server.sh" "${Server}:/tmp/"
  if ($LASTEXITCODE -ne 0) { throw 'upload failed' }

  Write-Host '==> Installing on the server'
  ssh @ssh $Server "sudo bash /tmp/setup-server.sh '$RemoteDir'"
  if ($LASTEXITCODE -ne 0) { throw 'server setup failed' }

  Write-Host "`nDone: https://$Domain  (admin: https://$Domain/admin)"
}
finally {
  Pop-Location
  Remove-Item (Join-Path $env:TEMP 'papi-deploy') -Recurse -Force -ErrorAction SilentlyContinue
}
