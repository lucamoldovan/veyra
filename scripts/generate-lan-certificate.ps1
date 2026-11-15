param(
    [Parameter(Mandatory = $true)]
    [string]$ServerIp,

    [string]$ServerDns = "ndiview.home.arpa"
)

$ErrorActionPreference = "Stop"

$parsedIp = $null
if (-not [System.Net.IPAddress]::TryParse($ServerIp, [ref]$parsedIp)) {
    throw "ServerIp must be a valid IPv4 or IPv6 address."
}
if ($ServerDns -notmatch '^[A-Za-z0-9.-]+$') {
    throw "ServerDns may contain only letters, numbers, dots and hyphens."
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$certDir = Join-Path $repoRoot "certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

foreach ($file in @("ca.key", "ca.crt", "server.key", "server.crt")) {
    $path = Join-Path $certDir $file
    if (Test-Path $path) {
        throw "Refusing to overwrite existing certificate material: $path. Back it up or remove the certs directory intentionally before regenerating."
    }
}

$config = @"
[req]
prompt = no
distinguished_name = distinguished_name
req_extensions = server_extensions

[ distinguished_name ]
CN = $ServerDns

[ server_extensions ]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @subject_alt_names

[ subject_alt_names ]
DNS.1 = $ServerDns
IP.1 = $ServerIp
"@

$configPath = Join-Path $certDir "server.cnf"
Set-Content -Path $configPath -Value $config -Encoding ascii

Write-Host "Generating a private local CA and a server certificate for $ServerDns ($ServerIp)..."
docker run --rm -v "${certDir}:/certs" alpine:3.22 sh -ec '
  apk add --no-cache openssl >/dev/null
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout /certs/ca.key -out /certs/ca.crt \
    -subj "/CN=NDIView Local Development CA"
  openssl req -new -newkey rsa:3072 -nodes \
    -keyout /certs/server.key -out /certs/server.csr \
    -config /certs/server.cnf
  openssl x509 -req -in /certs/server.csr \
    -CA /certs/ca.crt -CAkey /certs/ca.key -CAcreateserial \
    -out /certs/server.crt -days 825 -sha256 \
    -extfile /certs/server.cnf -extensions server_extensions
  rm -f /certs/server.csr /certs/ca.srl
'

if ($LASTEXITCODE -ne 0) {
    throw "OpenSSL certificate generation failed."
}

Write-Host ""
Write-Host "Created:"
Write-Host "  certs/ca.crt       - install this CA certificate on Windows and the receiver"
Write-Host "  certs/ca.key       - PRIVATE CA key; never share or commit"
Write-Host "  certs/server.crt   - server TLS certificate"
Write-Host "  certs/server.key   - PRIVATE server key; never share or commit"
Write-Host ""
Write-Host "Keep certs/ca.key and certs/server.key private."
