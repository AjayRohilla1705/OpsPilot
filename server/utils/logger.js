/**
 * Tiny zero-dependency logger with timestamps and levels.
 */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const write = (level, color, args) => {
  const head = `${colors.dim}${stamp()}${colors.reset} ${color}${level.padEnd(5)}${colors.reset}`;
  // eslint-disable-next-line no-console
  console.log(head, ...args);
};

const logger = {
  info: (...a) => write('INFO', colors.cyan, a),
  warn: (...a) => write('WARN', colors.yellow, a),
  error: (...a) => write('ERROR', colors.red, a),
  debug: (...a) => write('DEBUG', colors.magenta, a)
};

module.exports = { logger };
