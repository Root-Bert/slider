export interface Logger {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

export const consoleLogger: Logger = {
  info: (message, ...details) => console.info(message, ...details),
  warn: (message, ...details) => console.warn(message, ...details),
  error: (message, ...details) => console.error(message, ...details),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
