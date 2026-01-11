# Placeholder for SSL Certificates
#
# Place your SSL certificates in this directory:
#   - server.crt - Certificate file
#   - server.key - Private key file
#
# For self-signed testing:
#   openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
#     -keyout server.key -out server.crt \
#     -subj "/CN=localhost"
#
# For production, use certificates from a trusted CA or Let's Encrypt.
