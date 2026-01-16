# ProxyHub TLS Certificate Generation Script (PowerShell)
# This script generates the necessary certificates for secure tunnel communication

param(
    [string]$CertsDir = ".\certs",
    [int]$DaysValid = 365
)

$ErrorActionPreference = "Stop"

# Certificate paths
$CaKey = "$CertsDir\ca.key"
$CaCert = "$CertsDir\ca.crt"
$ServerKey = "$CertsDir\server.key"
$ServerCert = "$CertsDir\server.crt"
$ServerCsr = "$CertsDir\server.csr"
$ClientKey = "$CertsDir\client.key"
$ClientCert = "$CertsDir\client.crt"
$ClientCsr = "$CertsDir\client.csr"

Write-Host "🔐 ProxyHub TLS Certificate Generator" -ForegroundColor Cyan
Write-Host "======================================" -ForegroundColor Cyan

# Check for OpenSSL
$openssl = Get-Command openssl -ErrorAction SilentlyContinue
if (-not $openssl) {
    Write-Host "❌ OpenSSL not found. Install it via:" -ForegroundColor Red
    Write-Host "   winget install OpenSSL.Light" -ForegroundColor Yellow
    exit 1
}

# Create certs directory
if (-not (Test-Path $CertsDir)) {
    New-Item -ItemType Directory -Path $CertsDir | Out-Null
}

# 1. Generate CA (Certificate Authority)
Write-Host "`n📜 Generating CA certificate..." -ForegroundColor Yellow
if (-not (Test-Path $CaKey)) {
    openssl genrsa -out $CaKey 4096
    openssl req -new -x509 -days $DaysValid -key $CaKey -out $CaCert `
        -subj "/C=GH/ST=Greater Accra/L=Accra/O=ProxyHub/OU=Infrastructure/CN=ProxyHub CA"
    Write-Host "   ✅ CA certificate created" -ForegroundColor Green
} else {
    Write-Host "   ⏭️  CA certificate already exists, skipping" -ForegroundColor Gray
}

# 2. Generate Server Certificate (Edge Gateway)
Write-Host "`n🖥️  Generating server certificate..." -ForegroundColor Yellow
if (-not (Test-Path $ServerKey)) {
    openssl genrsa -out $ServerKey 2048
    
    # Create config for SAN (Subject Alternative Names)
    $serverConfig = @"
[req]
default_bits = 2048
prompt = no
default_md = sha256
distinguished_name = dn
req_extensions = req_ext

[dn]
C = GH
ST = Greater Accra
L = Accra
O = ProxyHub
OU = Edge Gateway
CN = gateway.proxyhubb.com

[req_ext]
subjectAltName = @alt_names

[alt_names]
DNS.1 = gateway.proxyhubb.com
DNS.2 = *.proxyhubb.com
DNS.3 = localhost
IP.1 = 127.0.0.1
IP.2 = 0.0.0.0
"@
    $serverConfig | Out-File -Encoding ASCII "$CertsDir\server.cnf"
    
    openssl req -new -key $ServerKey -out $ServerCsr -config "$CertsDir\server.cnf"
    
    # Sign with CA
    openssl x509 -req -in $ServerCsr -CA $CaCert -CAkey $CaKey -CAcreateserial `
        -out $ServerCert -days $DaysValid -sha256 `
        -extfile "$CertsDir\server.cnf" -extensions req_ext
    
    Write-Host "   ✅ Server certificate created" -ForegroundColor Green
} else {
    Write-Host "   ⏭️  Server certificate already exists, skipping" -ForegroundColor Gray
}

# 3. Generate Client Certificate (Provider)
Write-Host "`n👤 Generating client certificate..." -ForegroundColor Yellow
if (-not (Test-Path $ClientKey)) {
    openssl genrsa -out $ClientKey 2048
    openssl req -new -key $ClientKey -out $ClientCsr `
        -subj "/C=GH/ST=Greater Accra/L=Accra/O=ProxyHub/OU=Provider/CN=provider"
    
    # Sign with CA
    openssl x509 -req -in $ClientCsr -CA $CaCert -CAkey $CaKey -CAcreateserial `
        -out $ClientCert -days $DaysValid -sha256
    
    Write-Host "   ✅ Client certificate created" -ForegroundColor Green
} else {
    Write-Host "   ⏭️  Client certificate already exists, skipping" -ForegroundColor Gray
}

# Display summary
Write-Host "`n======================================" -ForegroundColor Cyan
Write-Host "📁 Certificates generated in: $CertsDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Files:"
Write-Host "  CA:     $CaCert (distribute to clients)"
Write-Host "  Server: $ServerKey, $ServerCert (Edge Gateway)"
Write-Host "  Client: $ClientKey, $ClientCert (Provider App)"
Write-Host ""
Write-Host "🔧 Configuration:" -ForegroundColor Yellow
Write-Host ""
Write-Host "Edge Gateway environment variables:"
Write-Host "  TLS_CERT_FILE=$ServerCert"
Write-Host "  TLS_KEY_FILE=$ServerKey"
Write-Host "  TLS_CA_FILE=$CaCert"
Write-Host ""
Write-Host "Provider App environment variables:"
Write-Host "  TLS_CERT_FILE=$ClientCert"
Write-Host "  TLS_KEY_FILE=$ClientKey"
Write-Host "  TLS_CA_FILE=$CaCert"
Write-Host ""
Write-Host "✅ TLS setup complete!" -ForegroundColor Green
