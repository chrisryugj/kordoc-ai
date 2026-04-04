/** stderr 로거 — stdout은 JSON-RPC 전용 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const time = new Date().toISOString().slice(11, 19);
  const tag = level.toUpperCase().padEnd(5);
  const formatted = args.length > 0
    ? `${time} [${tag}] ${message} ${args.map(a => JSON.stringify(a)).join(' ')}`
    : `${time} [${tag}] ${message}`;

  process.stderr.write(formatted + '\n');
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
};
