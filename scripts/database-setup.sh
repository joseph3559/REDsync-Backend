#!/bin/bash

################################################################################
# Database Setup Script for REDsync Backend
# Creates dev and production PostgreSQL databases
################################################################################

set -e

echo "=========================================="
echo "Setting up PostgreSQL databases..."
echo "=========================================="

# Generate random passwords
DEV_PASSWORD=$(openssl rand -base64 32)
PROD_PASSWORD=$(openssl rand -base64 32)

# Create PostgreSQL users and databases
sudo -u postgres psql << EOF
-- Create dev database and user
CREATE DATABASE redsync_dev;
CREATE USER redsync_dev_user WITH ENCRYPTED PASSWORD '$DEV_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE redsync_dev TO redsync_dev_user;
ALTER DATABASE redsync_dev OWNER TO redsync_dev_user;

-- Create production database and user
CREATE DATABASE redsync_prod;
CREATE USER redsync_prod_user WITH ENCRYPTED PASSWORD '$PROD_PASSWORD';
GRANT ALL PRIVILEGES ON DATABASE redsync_prod TO redsync_prod_user;
ALTER DATABASE redsync_prod OWNER TO redsync_prod_user;

-- Grant schema privileges for dev
\c redsync_dev
GRANT ALL ON SCHEMA public TO redsync_dev_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO redsync_dev_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO redsync_dev_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO redsync_dev_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO redsync_dev_user;

-- Grant schema privileges for production
\c redsync_prod
GRANT ALL ON SCHEMA public TO redsync_prod_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO redsync_prod_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO redsync_prod_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO redsync_prod_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO redsync_prod_user;

\q
EOF

echo ""
echo "=========================================="
echo "Databases created successfully!"
echo "=========================================="
echo ""
echo "Database Credentials:"
echo ""
echo "--- DEVELOPMENT ---"
echo "Database: redsync_dev"
echo "User: redsync_dev_user"
echo "Password: $DEV_PASSWORD"
echo "Connection String: postgresql://redsync_dev_user:$DEV_PASSWORD@localhost:5432/redsync_dev"
echo ""
echo "--- PRODUCTION ---"
echo "Database: redsync_prod"
echo "User: redsync_prod_user"
echo "Password: $PROD_PASSWORD"
echo "Connection String: postgresql://redsync_prod_user:$PROD_PASSWORD@localhost:5432/redsync_prod"
echo ""
echo "IMPORTANT: Save these credentials securely!"
echo "Add them to your GitHub Secrets:"
echo "  - DEV_DATABASE_URL"
echo "  - PROD_DATABASE_URL"
echo ""

