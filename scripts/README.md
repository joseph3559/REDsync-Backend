# Deployment Scripts

This directory contains scripts for setting up and deploying the REDsync backend on AlmaLinux 9 VPS.

## Scripts Overview

| Script | Purpose | Runtime |
|--------|---------|---------|
| `server-setup.sh` | Initial VPS setup - installs Node.js, PostgreSQL, Nginx, PM2, Python | 10-15 min |
| `database-setup.sh` | Creates dev and production PostgreSQL databases with users | 2 min |
| `ssl-setup.sh` | Installs SSL certificates using Let's Encrypt for both domains | 5 min |

## Usage Order

Run scripts in this order for initial setup:

```bash
# 1. Server setup (installs all dependencies)
sudo ./scripts/server-setup.sh

# 2. Database setup (creates databases and users)
sudo ./scripts/database-setup.sh

# 3. SSL setup (requires DNS to be configured first!)
sudo ./scripts/ssl-setup.sh
```

## Prerequisites

### Before Running Scripts

1. **DNS Configuration**: Ensure domains point to VPS IP
   ```bash
   # Verify DNS
   dig redlecithin.online +short
   dig dev.redlecithin.online +short
   # Both should return: 159.198.70.44
   ```

2. **VPS Access**: SSH access with root or sudo privileges
   ```bash
   ssh root@159.198.70.44
   ```

3. **Repository Cloned**: Scripts should be available
   ```bash
   git clone https://github.com/joseph3559/REDsync-Backend.git
   cd REDsync-Backend
   chmod +x scripts/*.sh
   ```

## Detailed Script Information

### server-setup.sh

**What it does:**
- Updates system packages
- Installs development tools (gcc, make, git, etc.)
- Installs Node.js 20.x LTS
- Installs PostgreSQL 15
- Installs and configures Nginx
- Installs PM2 globally for process management
- Installs Python 3 and dependencies for COA parsing
- Configures firewall (opens ports 80, 443)
- Creates application directories

**Requirements:**
- Root or sudo access
- Internet connection

**Output:**
- Node.js installed at `/usr/bin/node`
- PostgreSQL running on port 5432
- Nginx running on ports 80/443
- PM2 installed globally
- Application directories: `/var/www/redsync/{dev,prod}`

### database-setup.sh

**What it does:**
- Generates secure random passwords for database users
- Creates `redsync_dev` database with dedicated user
- Creates `redsync_prod` database with dedicated user
- Grants necessary permissions
- Outputs connection strings

**Requirements:**
- PostgreSQL must be installed (run `server-setup.sh` first)
- Root or sudo access

**Output:**
- Two databases with full credentials
- Connection strings for GitHub Secrets

**Important:** Save the output! You'll need these credentials for:
- GitHub Actions secrets
- Manual deployments
- Database backups

### ssl-setup.sh

**What it does:**
- Installs Certbot (Let's Encrypt client)
- Obtains SSL certificates for production domain
- Obtains SSL certificates for development domain
- Configures Nginx with SSL
- Sets up automatic certificate renewal
- Creates renewal hooks

**Requirements:**
- DNS must be configured and propagated
- Nginx must be installed
- Domains must resolve to VPS IP
- Ports 80 and 443 must be accessible

**Output:**
- SSL certificates in `/etc/letsencrypt/live/`
- Nginx configured with HTTPS
- Automatic renewal timer enabled

**Note:** Run this AFTER DNS propagation (wait 5-60 minutes after DNS changes)

## Troubleshooting

### server-setup.sh Issues

**Problem**: Node.js installation fails
```bash
# Solution: Clear cache and retry
sudo dnf clean all
sudo dnf update -y
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs
```

**Problem**: PostgreSQL won't start
```bash
# Check logs
sudo journalctl -u postgresql -n 50

# Reinitialize if needed
sudo rm -rf /var/lib/pgsql/15/data/*
sudo postgresql-setup --initdb
sudo systemctl start postgresql
```

**Problem**: Firewall blocks connections
```bash
# Check firewall status
sudo firewall-cmd --list-all

# Re-add rules
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### database-setup.sh Issues

**Problem**: Permission denied
```bash
# Ensure PostgreSQL is running
sudo systemctl status postgresql
sudo systemctl start postgresql

# Verify postgres user exists
sudo -u postgres psql -c "SELECT version();"
```

**Problem**: Database already exists
```bash
# Drop and recreate
sudo -u postgres psql -c "DROP DATABASE IF EXISTS redsync_dev;"
sudo -u postgres psql -c "DROP DATABASE IF EXISTS redsync_prod;"
# Then rerun script
```

### ssl-setup.sh Issues

**Problem**: DNS not resolving
```bash
# Check DNS propagation
dig redlecithin.online +short
nslookup redlecithin.online

# Wait and retry if not propagated
# DNS can take 5-60 minutes
```

**Problem**: Certificate generation fails
```bash
# Check Nginx is running
sudo systemctl status nginx

# Check port 80 is accessible
curl -I http://redlecithin.online

# Verify domain ownership
sudo certbot certonly --manual -d redlecithin.online --preferred-challenges dns
```

**Problem**: Certificate renewal fails
```bash
# Test renewal
sudo certbot renew --dry-run

# Check logs
sudo tail -f /var/log/letsencrypt/letsencrypt.log

# Manual renewal
sudo certbot renew --force-renewal
```

## Post-Installation Verification

After running all scripts, verify everything works:

```bash
# 1. Check Node.js
node --version  # Should show v20.x.x
npm --version   # Should show 10.x.x

# 2. Check PostgreSQL
sudo systemctl status postgresql
sudo -u postgres psql -l  # List databases

# 3. Check Nginx
sudo systemctl status nginx
sudo nginx -t  # Test configuration

# 4. Check PM2
pm2 --version
pm2 list

# 5. Check SSL certificates
sudo certbot certificates

# 6. Check firewall
sudo firewall-cmd --list-all

# 7. Check application directories
ls -la /var/www/redsync/
```

## Security Notes

1. **Save Credentials Securely**
   - Database passwords are generated randomly
   - Store them in a password manager
   - Never commit them to Git

2. **SSH Keys**
   - Use SSH key authentication instead of passwords
   - Keep private keys secure
   - Use different keys for different purposes

3. **Firewall**
   - Only necessary ports are opened (80, 443, 22)
   - Consider restricting SSH access by IP

4. **Database Access**
   - Database users have limited permissions
   - Production and dev databases are isolated
   - Consider enabling SSL for PostgreSQL

## Maintenance

### Regular Updates

```bash
# System updates (monthly)
sudo dnf update -y

# Node.js updates (quarterly)
# Check: https://nodejs.org/en/download/
# Update if needed

# Certificate renewal (automatic, but verify)
sudo certbot renew --dry-run
```

### Backups

```bash
# Database backup
sudo -u postgres pg_dump redsync_prod > backup_$(date +%Y%m%d).sql

# Automated backup (add to crontab)
sudo crontab -e
# Add: 0 2 * * * /usr/bin/pg_dump redsync_prod > /backups/redsync_$(date +\%Y\%m\%d).sql
```

### Monitoring

```bash
# Check disk space
df -h

# Check memory
free -m

# Check running processes
pm2 list
pm2 monit

# Check Nginx logs
sudo tail -f /var/log/nginx/access.log
```

## Rollback

If something goes wrong, here's how to rollback:

```bash
# Rollback application
cd /var/www/redsync/prod
git log  # Find previous commit
git reset --hard [commit-hash]
pm2 restart redsync-prod

# Rollback database
sudo -u postgres psql redsync_prod < backup_previous.sql

# Rollback Nginx
sudo cp /etc/nginx/conf.d/redsync-prod.conf.backup /etc/nginx/conf.d/redsync-prod.conf
sudo systemctl restart nginx
```

## Getting Help

If you encounter issues:

1. Check logs:
   - Application: `pm2 logs`
   - Nginx: `/var/log/nginx/`
   - PostgreSQL: `/var/lib/pgsql/15/data/log/`
   - System: `sudo journalctl -xe`

2. Review documentation:
   - Main deployment guide: `../DEPLOYMENT.md`
   - Quick start: `../QUICK_DEPLOY.md`

3. Common issues:
   - DNS not propagated: Wait 5-60 minutes
   - Port conflicts: Check with `sudo netstat -tlnp`
   - Permission issues: Check file ownership with `ls -la`

## Additional Resources

- [Node.js Documentation](https://nodejs.org/docs/)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Nginx Documentation](https://nginx.org/en/docs/)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [AlmaLinux Documentation](https://wiki.almalinux.org/)

## Script Maintenance

These scripts are maintained as part of the REDsync Backend repository.

**Report Issues:**
- GitHub Issues: https://github.com/joseph3559/REDsync-Backend/issues

**Contribute:**
- Pull requests welcome for script improvements
- Test on a clean AlmaLinux 9 installation
- Update this README if adding new scripts

