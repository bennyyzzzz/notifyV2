import { pino, type DestinationStream, type Logger, type LoggerOptions } from 'pino';

/**
 * Paths removed from every log line. Covers request headers and the common shapes in which
 * credentials, FCM tokens and private keys may appear (8 — Logs e monitoramento).
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-notify-signature"]',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  ...['password', 'passwordHash', 'privateKey', 'private_key', 'fcmToken', 'token', 'refreshToken', 'secret', 'mfaSecret', 'apiKey', 'serverKey'].flatMap(
    (key) => [key, `*.${key}`, `*.*.${key}`],
  ),
  '*.secret',
  'err.config',
];

export interface CreateLoggerOptions {
  service: 'api' | 'worker' | 'cli';
  level: LoggerOptions['level'];
  destination?: DestinationStream;
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const loggerOptions: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service },
    messageKey: 'msg',
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: [...new Set(REDACT_PATHS)], censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
  };
  return options.destination ? pino(loggerOptions, options.destination) : pino(loggerOptions);
}

export type { Logger };
