# Generate certificates for mTLS
# Usage: .\generate_certs.ps1

$certDir = "../certs"
if (!(Test-Path -Path $certDir)) {
    New-Item -ItemType Directory -Path $certDir | Out-Null
}

echo "Generating CA..."
openssl req -x509 -newkey rsa:4096 -days 365 -nodes -keyout "$certDir/ca.key" -out "$certDir/ca.crt" -subj "/CN=ProxyHubCA"

echo "Generating Server Cert..."
openssl req -newkey rsa:4096 -nodes -keyout "$certDir/server.key" -out "$certDir/server.csr" -subj "/CN=localhost"
openssl x509 -req -in "$certDir/server.csr" -CA "$certDir/ca.crt" -CAkey "$certDir/ca.key" -CAcreateserial -out "$certDir/server.crt" -days 365

echo "Generating Client Cert..."
openssl req -newkey rsa:4096 -nodes -keyout "$certDir/client.key" -out "$certDir/client.csr" -subj "/CN=client"
openssl x509 -req -in "$certDir/client.csr" -CA "$certDir/ca.crt" -CAkey "$certDir/ca.key" -CAcreateserial -out "$certDir/client.crt" -days 365

echo "Done. Certificates generated in $certDir"
