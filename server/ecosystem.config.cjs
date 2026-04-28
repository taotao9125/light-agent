require('dotenv').config()

module.exports = {
  apps: [
    {
      name: 'bookstore-server',
      script: './bin/www',
      out_file: './logs/access.log',
      error_file: './logs/error.log',
      env: {
        NODE_ENV: 'development',
        PORT: process.env.PORT || 3000
      }
    }
  ]
}