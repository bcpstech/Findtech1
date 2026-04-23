/**
 * scraper/logger.js
 * Logger centralizado con Winston — guarda en consola y en archivos.
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');

const LOG_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const fmt = winston.format;

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: fmt.combine(
    fmt.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    fmt.errors({ stack: true }),
    fmt.json()
  ),
  transports: [
    // Consola — legible para humanos
    new winston.transports.Console({
      format: fmt.combine(
        fmt.colorize(),
        fmt.timestamp({ format: 'HH:mm:ss' }),
        fmt.printf(({ timestamp, level, message, store, ...rest }) => {
          const storeTag = store ? `[${store}] ` : '';
          const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
          return `${timestamp} ${level}: ${storeTag}${message}${extra}`;
        })
      )
    }),
    // Archivo general
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'scraper.log'),
      maxsize: 5 * 1024 * 1024, // 5 MB
      maxFiles: 7,
      tailable: true
    }),
    // Solo errores
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'errors.log'),
      level: 'error',
      maxsize: 2 * 1024 * 1024,
      maxFiles: 3
    })
  ]
});

module.exports = logger;
