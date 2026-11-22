#!/usr/bin/env bash
# Certificado autofirmado para HTTPS en la red del local (gratis, con openssl).
# Los navegadores muestran una advertencia la primera vez; para un dominio real usar Let's Encrypt (gratis) en el servidor.
set -euo pipefail
IP="${1:-$(node -e "const n=require('os').networkInterfaces();for(const l of Object.values(n))for(const a of l)if(a.family==='IPv4'&&!a.internal){console.log(a.address);process.exit()}console.log('127.0.0.1')")}"
mkdir -p certs
MSYS_NO_PATHCONV=1 openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=BM Dev Restaurant" -addext "subjectAltName=IP:${IP},DNS:localhost"
echo "Listo: certs/key.pem y certs/cert.pem para ${IP}. Agregá HTTPS_KEY y HTTPS_CERT en .env."
