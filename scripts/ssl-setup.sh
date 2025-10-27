#!/bin/bash

################################################################################
# SSL Certificate Setup Script using Let's Encrypt (Certbot)
# Sets up SSL certificates for both production and development domains
################################################################################

set -e

echo "=========================================="
echo "Setting up SSL certificates..."
echo "=========================================="

# Install Certbot
echo "Installing Certbot..."
sudo dnf install -y certbot python3-certbot-nginx

# Create directory for Let's Encrypt challenges
sudo mkdir -p /var/www/certbot

# Install temporary Nginx configuration for certificate generation
echo "Setting up temporary Nginx configuration..."
sudo tee /etc/nginx/conf.d/temp-certbot.conf > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name redlecithin.online www.redlecithin.online dev.redlecithin.online;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 200 'OK';
        add_header Content-Type text/plain;
    }
}
EOF

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx

# Obtain certificates for production domain
echo "Obtaining SSL certificate for production domain..."
sudo certbot certonly --webroot \
    -w /var/www/certbot \
    -d redlecithin.online \
    -d www.redlecithin.online \
    --non-interactive \
    --agree-tos \
    --email scottjoe3559@gmail.com

# Obtain certificates for development domain
echo "Obtaining SSL certificate for development domain..."
sudo certbot certonly --webroot \
    -w /var/www/certbot \
    -d dev.redlecithin.online \
    --non-interactive \
    --agree-tos \
    --email scottjoe3559@gmail.com

# Remove temporary Nginx configuration
sudo rm /etc/nginx/conf.d/temp-certbot.conf

# Install production Nginx configuration
echo "Installing Nginx configurations..."
sudo cp /var/www/redsync/prod/nginx/production.conf /etc/nginx/conf.d/redsync-prod.conf
sudo cp /var/www/redsync/prod/nginx/development.conf /etc/nginx/conf.d/redsync-dev.conf

# Test and reload Nginx
sudo nginx -t
sudo systemctl reload nginx

# Set up automatic certificate renewal
echo "Setting up automatic certificate renewal..."
sudo systemctl enable certbot-renew.timer
sudo systemctl start certbot-renew.timer

# Create renewal hook to reload Nginx
sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh > /dev/null << 'EOF'
#!/bin/bash
systemctl reload nginx
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh

echo "=========================================="
echo "SSL certificates installed successfully!"
echo "=========================================="
echo ""
echo "Production domain: https://redlecithin.online"
echo "Development domain: https://dev.redlecithin.online"
echo ""
echo "Certificates will auto-renew via certbot timer."
echo ""

