#!/bin/bash

################################################################################
# VPS Server Setup Script for REDsync Backend on AlmaLinux 9
# This script installs all necessary dependencies and configures the server
################################################################################

set -e

echo "=========================================="
echo "Starting VPS Server Setup..."
echo "=========================================="

# Update system packages
echo "Updating system packages..."
sudo dnf update -y

# Install essential build tools
echo "Installing development tools..."
sudo dnf groupinstall "Development Tools" -y
sudo dnf install -y git curl wget vim

# Install Node.js 20.x (LTS)
echo "Installing Node.js..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs

# Verify Node.js installation
node --version
npm --version

# Install PostgreSQL 15
echo "Installing PostgreSQL 15..."
sudo dnf install -y postgresql15-server postgresql15-contrib

# Initialize PostgreSQL
echo "Initializing PostgreSQL..."
sudo postgresql-setup --initdb

# Start and enable PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Install Nginx
echo "Installing Nginx..."
sudo dnf install -y nginx

# Start and enable Nginx
sudo systemctl start nginx
sudo systemctl enable nginx

# Install PM2 globally for process management
echo "Installing PM2..."
sudo npm install -g pm2

# Setup PM2 to start on boot
sudo pm2 startup systemd -u root --hp /root
sudo systemctl enable pm2-root

# Install Python 3 and pip (for parse_coa_pdf.py)
echo "Installing Python 3..."
sudo dnf install -y python3 python3-pip

# Install Python dependencies for COA parsing
echo "Installing Python dependencies..."
sudo pip3 install PyPDF2 pdfplumber openai python-dotenv

# Configure firewall
echo "Configuring firewall..."
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-port=80/tcp
sudo firewall-cmd --permanent --add-port=443/tcp
sudo firewall-cmd --reload

# Create application directory
echo "Creating application directory..."
sudo mkdir -p /var/www/redsync
sudo chown -R $USER:$USER /var/www/redsync

# Create directories for dev and production
sudo mkdir -p /var/www/redsync/dev
sudo mkdir -p /var/www/redsync/prod
sudo chown -R $USER:$USER /var/www/redsync

echo "=========================================="
echo "Server setup completed successfully!"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Configure PostgreSQL databases (run database-setup.sh)"
echo "2. Configure Nginx reverse proxy"
echo "3. Set up SSL certificates with Let's Encrypt"
echo "4. Configure GitHub Actions secrets"
echo ""

