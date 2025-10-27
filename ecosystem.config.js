module.exports = {
  apps: [
    {
      name: 'redsync-prod',
      script: './dist/server.js',
      cwd: '/var/www/redsync/prod',
      instances: 2,
      exec_mode: 'cluster',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 4000
      },
      error_file: '/var/log/pm2/redsync-prod-error.log',
      out_file: '/var/log/pm2/redsync-prod-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    },
    {
      name: 'redsync-dev',
      script: './dist/server.js',
      cwd: '/var/www/redsync/dev',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'development',
        PORT: 4001
      },
      error_file: '/var/log/pm2/redsync-dev-error.log',
      out_file: '/var/log/pm2/redsync-dev-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};

