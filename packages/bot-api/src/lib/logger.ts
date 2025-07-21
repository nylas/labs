import pino from 'pino';

// Edge Runtime compatible logger configuration
const isDevelopment = process.env.NODE_ENV === 'development';
const logLevel = process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info');

// Create the base logger
const baseLogger = pino({
  name: 'mcp-bot-api',
  level: logLevel,
  // Use pretty printing in development, JSON in production
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
      },
    },
  }),
  // Add default fields
  base: {
    env: process.env.NODE_ENV,
  },
});

export interface LogContext {
  requestId?: string;
  grantId?: string;
  userId?: string;
  operation?: string;
  [key: string]: unknown;
}

export class Logger {
  private logger: pino.Logger;

  constructor(context: LogContext = {}) {
    this.logger = baseLogger.child(context);
  }

  // Create a child logger with additional context
  child(context: LogContext): Logger {
    return new Logger(context);
  }

  // Info level logging
  info(message: string, extra?: object): void {
    this.logger.info(extra, message);
  }

  // Warning level logging
  warn(message: string, extra?: object): void {
    this.logger.warn(extra, message);
  }

  // Error level logging
  error(message: string, error?: Error | unknown, extra?: object): void {
    const errorObj = error instanceof Error 
      ? { 
          error: error.message, 
          stack: error.stack,
          name: error.name 
        }
      : { error: String(error) };
    
    this.logger.error({ ...errorObj, ...extra }, message);
  }

  // Debug level logging
  debug(message: string, extra?: object): void {
    this.logger.debug(extra, message);
  }

  // Success operations
  success(message: string, extra?: object): void {
    this.logger.info({ success: true, ...extra }, message);
  }

  // Redis-specific logging methods
  redisOperation(operation: string, key?: string, extra?: object): void {
    this.logger.debug({ 
      operation: 'redis', 
      redisOperation: operation,
      key,
      ...extra 
    }, `Redis ${operation}`);
  }

  redisError(operation: string, error: Error | unknown, key?: string, extra?: object): void {
    const errorObj = error instanceof Error 
      ? { 
          error: error.message, 
          stack: error.stack,
          name: error.name 
        }
      : { error: String(error) };

    this.logger.error({ 
      operation: 'redis', 
      redisOperation: operation,
      key,
      ...errorObj,
      ...extra 
    }, `Redis ${operation} failed`);
  }

  // HTTP request logging
  httpRequest(method: string, url: string, extra?: object): void {
    this.logger.info({ 
      operation: 'http_request',
      method,
      url,
      ...extra 
    }, `${method} ${url}`);
  }

  httpResponse(method: string, url: string, status: number, duration?: number, extra?: object): void {
    this.logger.info({ 
      operation: 'http_response',
      method,
      url,
      status,
      duration,
      ...extra 
    }, `${method} ${url} ${status}${duration ? ` (${duration}ms)` : ''}`);
  }

  httpError(method: string, url: string, error: Error | unknown, extra?: object): void {
    const errorObj = error instanceof Error 
      ? { 
          error: error.message, 
          stack: error.stack,
          name: error.name 
        }
      : { error: String(error) };

    this.logger.error({ 
      operation: 'http_error',
      method,
      url,
      ...errorObj,
      ...extra 
    }, `${method} ${url} failed`);
  }

  // OAuth specific logging
  oauthStart(provider: string, extra?: object): void {
    this.logger.info({ 
      operation: 'oauth_start',
      provider,
      ...extra 
    }, `OAuth flow started for ${provider}`);
  }

  oauthSuccess(provider: string, grantId: string, extra?: object): void {
    this.logger.info({ 
      operation: 'oauth_success',
      provider,
      grantId,
      ...extra 
    }, `OAuth flow completed successfully for ${provider}`);
  }

  oauthError(provider: string, error: Error | unknown, extra?: object): void {
    const errorObj = error instanceof Error 
      ? { 
          error: error.message, 
          stack: error.stack,
          name: error.name 
        }
      : { error: String(error) };

    this.logger.error({ 
      operation: 'oauth_error',
      provider,
      ...errorObj,
      ...extra 
    }, `OAuth flow failed for ${provider}`);
  }

  // JWT specific logging
  jwtOperation(operation: string, extra?: object): void {
    this.logger.debug({ 
      operation: 'jwt',
      jwtOperation: operation,
      ...extra 
    }, `JWT ${operation}`);
  }

  jwtError(operation: string, error: Error | unknown, extra?: object): void {
    const errorObj = error instanceof Error 
      ? { 
          error: error.message, 
          stack: error.stack,
          name: error.name 
        }
      : { error: String(error) };

    this.logger.error({ 
      operation: 'jwt',
      jwtOperation: operation,
      ...errorObj,
      ...extra 
    }, `JWT ${operation} failed`);
  }
}

// Export a default logger instance
export const logger = new Logger();

// Helper function to create a logger with request context
export function createRequestLogger(requestId: string, additionalContext?: LogContext): Logger {
  return new Logger({ requestId, ...additionalContext });
}

// Helper function to extract request ID from headers
export function getRequestLogger(request: Request): Logger {
  const requestId = request.headers.get('x-request-id') || 
                   request.headers.get('cf-ray') || 
                   crypto.randomUUID();
  
  return createRequestLogger(requestId);
} 