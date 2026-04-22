/**
 * logger utility
 * ---------------
 * A tiny logging wrapper so every log line has a timestamp.
 *
 * We're not using Winston or Pino because this service doesn't need
 * log levels, rotation, or structured JSON — a readable console log
 * is all we need at this scale. If that changes, swap this file out.
 */

export const logger = {
  info: (msg: string, ...args: unknown[]): void => {
    console.log(`[${new Date().toISOString()}] INFO  ${msg}`, ...args);
  },
  error: (msg: string, ...args: unknown[]): void => {
    console.error(`[${new Date().toISOString()}] ERROR ${msg}`, ...args);
  },
  warn: (msg: string, ...args: unknown[]): void => {
    console.warn(`[${new Date().toISOString()}] WARN  ${msg}`, ...args);
  },
};
