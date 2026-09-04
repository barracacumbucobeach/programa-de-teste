'use strict';

/**
 * Logger leve, colorido e compatível com a interface esperada pelo Baileys
 * (trace/debug/info/warn/error/fatal + child()), sem depender de pacotes
 * externos como pino.
 */

const LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

const COLORS = {
  trace: '\x1b[90m',
  debug: '\x1b[36m',
  info: '\x1b[32m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  fatal: '\x1b[41m\x1b[97m',
};

const RESET = '\x1b[0m';

function createLogger(scope = 'engine', minLevel = 'info') {
  const minIndex = LEVELS.indexOf(minLevel);

  function write(level, args) {
    if (LEVELS.indexOf(level) < minIndex) return;
    const color = COLORS[level] || '';
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const tag = `${color}[${level.toUpperCase()}]${RESET}`;
    console.log(`${tag} ${time} \x1b[2m(${scope})\x1b[0m`, ...args);
  }

  const logger = { level: minLevel };

  for (const level of LEVELS) {
    logger[level] = (...args) => write(level, args);
  }

  logger.child = (bindings = {}) => createLogger(bindings.scope || scope, minLevel);

  return logger;
}

module.exports = { createLogger };
