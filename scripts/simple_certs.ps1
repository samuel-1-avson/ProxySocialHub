$ErrorActionPreference = "Stop"
$certsDir = "certs"
if (!(Test-Path $certsDir)) { New-Item -ItemType Directory -Path $certsDir | Out-Null }

function Export-Pem($cert, $path) {
    $bytes = $cert.Export("Cert")
    $b64 = [System.Convert]::ToBase64String($bytes, "InsertLineBreaks")
    "-----BEGIN CERTIFICATE-----`r`n$b64`r`n-----END CERTIFICATE-----" | Out-File -Encoding ASCII $path
}

function Export-Key($cert, $path) {
    $rsa = $cert.GetRSAPrivateKey()
    $bytes = $rsa.ExportPkcs8PrivateKey()
    $b64 = [System.Convert]::ToBase64String($bytes, "InsertLineBreaks")
    "-----BEGIN PRIVATE KEY-----`r`n$b64`r`n-----END PRIVATE KEY-----" | Out-File -Encoding ASCII $path
}

Write-Host "Generating CA..."
$ca = New-SelfSignedCertificate -Subject "CN=ProxyHub CA" -KeyUsage CertSign,CRLSign,DigitalSignature -CertStoreLocation "Cert:\CurrentUser\My" -KeyExportPolicy Exportable

Export-Pem $ca "$certsDir\ca.crt"
Export-Key $ca "$certsDir\ca.key"

Write-Host "Generating Server..."
$ext = "2.5.29.17={text}DNS=localhost&IPAddress=127.0.0.1"
$server = New-SelfSignedCertificate -Subject "CN=localhost" -Signer $ca -KeyUsage KeyEncipherment,DigitalSignature -TextExtension @($ext) -CertStoreLocation "Cert:\CurrentUser\My" -KeyExportPolicy Exportable

Export-Pem $server "$certsDir\server.crt"
Export-Key $server "$certsDir\server.key"

Write-Host "Generating Client..."
$client = New-SelfSignedCertificate -Subject "CN=provider" -Signer $ca -KeyUsage KeyEncipherment,DigitalSignature -CertStoreLocation "Cert:\CurrentUser\My" -KeyExportPolicy Exportable

Export-Pem $client "$certsDir\client.crt"
Export-Key $client "$certsDir\client.key"

Write-Host "Done."
