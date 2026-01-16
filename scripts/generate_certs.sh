#!/bin/bash
# ProxyHub TLS Certificate Generation Script
# This script generates the necessary certificates for secure tunnel communication

set -e

CERTS_DIR="./certs"
CA_KEY="$CERTS_DIR/ca.key"
CA_CERT="$CERTS_DIR/ca.crt"
SERVER_KEY="$CERTS_DIR/server.key"
SERVER_CERT="$CERTS_DIR/server.crt"
SERVER_CSR="$CERTS_DIR/server.csr"
CLIENT_KEY="$CERTS_DIR/client.key"
CLIENT_CERT="$CERTS_DIR/client.crt"
CLIENT_CSR="$CERTS_DIR/client.csr"

DAYS_VALID=365
CA_SUBJECT="/C=GH/ST=Greater Accra/L=Accra/O=ProxyHub/OU=Infrastructure/CN=ProxyHub CA"
SERVER_SUBJECT="/C=GH/ST=Greater Accra/L=Accra/O=ProxyHub/OU=Edge Gateway/CN=gateway.proxyhubb.com"
CLIENT_SUBJECT="/C=GH/ST=Greater Accra/L=Accra/O=ProxyHub/OU=Provider/CN=provider"

echo "🔐 ProxyHub TLS Certificate Generator"
echo "======================================"

# Create certs directory
mkdir -p "$CERTS_DIR"

# 1. Generate CA (Certificate Authority)
echo "📜 Generating CA certificate..."
if [ ! -f "$CA_KEY" ]; then
    openssl genrsa -out "$CA_KEY" 4096
    openssl req -new -x509 -days $DAYS_VALID -key "$CA_KEY" -out "$CA_CERT" -subj "$CA_SUBJECT"
    echo "   ✅ CA certificate created"
else
    echo "   ⏭️  CA certificate already exists, skipping"
fi

# 2. Generate Server Certificate (Edge Gateway)
echo "🖥️  Generating server certificate..."
if [ ! -f "$SERVER_KEY" ]; then
    openssl genrsa -out "$SERVER_KEY" 2048
    
    # Create config for SAN (Subject Alternative Names)
    cat > "$CERTS_DIR/server.cnf" << EOF
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
EOF

    openssl req -new -key "$SERVER_KEY" -out "$SERVER_CSR" -config "$CERTS_DIR/server.cnf"
    
    # Sign with CA
    openssl x509 -req -in "$SERVER_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
        -out "$SERVER_CERT" -days $DAYS_VALID -sha256 \
        -extfile "$CERTS_DIR/server.cnf" -extensions req_ext
    
    echo "   ✅ Server certificate created"
else
    echo "   ⏭️  Server certificate already exists, skipping"
fi

# 3. Generate Client Certificate (Provider)
echo "👤 Generating client certificate..."
if [ ! -f "$CLIENT_KEY" ]; then
    openssl genrsa -out "$CLIENT_KEY" 2048
    openssl req -new -key "$CLIENT_KEY" -out "$CLIENT_CSR" -subj "$CLIENT_SUBJECT"
    
    # Sign with CA
    openssl x509 -req -in "$CLIENT_CSR" -CA "$CA_CERT" -CAkey "$CA_KEY" -CAcreateserial \
        -out "$CLIENT_CERT" -days $DAYS_VALID -sha256
    
    echo "   ✅ Client certificate created"
else
    echo "   ⏭️  Client certificate already exists, skipping"
fi

# Display summary
echo ""
echo "======================================"
echo "📁 Certificates generated in: $CERTS_DIR"
echo ""
echo "Files:"
echo "  CA:     $CA_CERT (distribute to clients)"
echo "  Server: $SERVER_KEY, $SERVER_CERT (Edge Gateway)"
echo "  Client: $CLIENT_KEY, $CLIENT_CERT (Provider App)"
echo ""
echo "🔧 Configuration:"
echo ""
echo "Edge Gateway environment variables:"
echo "  TLS_CERT_FILE=$SERVER_CERT"
echo "  TLS_KEY_FILE=$SERVER_KEY"
echo "  TLS_CA_FILE=$CA_CERT"
echo ""
echo "Provider App environment variables:"
echo "  TLS_CERT_FILE=$CLIENT_CERT"
echo "  TLS_KEY_FILE=$CLIENT_KEY"
echo "  TLS_CA_FILE=$CA_CERT"
echo ""
echo "✅ TLS setup complete!"
