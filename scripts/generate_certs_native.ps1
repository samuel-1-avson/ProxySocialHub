# PowerShell Native Certificate Generator (No OpenSSL required)
# Generates PEM format certificates for ProxyHub

param(
    [string]$CertsDir = ".\certs"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $CertsDir)) {
    New-Item -ItemType Directory -Path $CertsDir | Out-Null
}

function Export-CertToPem {
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert,
        [string]$Path
    )
    $bytes = $Cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert)
    $b64 = [System.Convert]::ToBase64String($bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
    
    $pem = "-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----"
    $pem | Out-File -Encoding ASCII $Path
}

function Export-KeyToPem {
    param(
        [System.Security.Cryptography.X509Certificates.X509Certificate2]$Cert,
        [string]$Path
    )
    $rsa = $Cert.GetRSAPrivateKey()
    if ($null -eq $rsa) { throw "No private key found" }
    
    $bytes = $rsa.ExportPkcs8PrivateKey()
    $b64 = [System.Convert]::ToBase64String($bytes, [System.Base64FormattingOptions]::InsertLineBreaks)
    
    $pem = "-----BEGIN PRIVATE KEY-----`r`n$b64`r`n-----END PRIVATE KEY-----"
    $pem | Out-File -Encoding ASCII $Path
}

Write-Host "🔐 Generating Certificates (Native Windows API)..." -ForegroundColor Cyan

# 1. CA Certificate
Write-Host "  Generating CA..."
$caCert = New-SelfSignedCertificate `
    -Subject "CN=ProxyHub CA, O=ProxyHub, C=GH" `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -KeyUsage CertSign,CRLSign,DigitalSignature `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(1)

Export-CertToPem -Cert $caCert -Path "$CertsDir\ca.crt"
Export-KeyToPem -Cert $caCert -Path "$CertsDir\ca.key"

# 2. Server Certificate
Write-Host "  Generating Server Cert..."
$san = '2.5.29.17={text}DNS=gateway.proxyhubb.com&DNS=localhost&IPAddress=127.0.0.1&IPAddress=0.0.0.0'
$serverCert = New-SelfSignedCertificate `
    -Subject "CN=gateway.proxyhubb.com" `
    -Signer $caCert `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -KeyUsage KeyEncipherment,DigitalSignature `
    -TextExtension @($san) `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(1)

Export-CertToPem -Cert $serverCert -Path "$CertsDir\server.crt"
Export-KeyToPem -Cert $serverCert -Path "$CertsDir\server.key"

# 3. Client Certificate
Write-Host "  Generating Client Cert..."
$clientCert = New-SelfSignedCertificate `
    -Subject "CN=provider" `
    -Signer $caCert `
    -KeyExportPolicy Exportable `
    -KeyLength 2048 `
    -KeyUsage KeyEncipherment,DigitalSignature `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -NotAfter (Get-Date).AddYears(1)

Export-CertToPem -Cert $clientCert -Path "$CertsDir\client.crt"
Export-KeyToPem -Cert $clientCert -Path "$CertsDir\client.key"

Write-Host "✅ Certificates generated in $CertsDir" -ForegroundColor Green
Write-Host "PEM files are ready for Rustls."
