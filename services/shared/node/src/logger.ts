import pino, { type Logger } from 'pino';

let serviceName = 'habitloop';
export function createLogger(service: string): Logger {
  serviceName = service;
  return pino({ level: process.env.LOG_LEVEL?.toLowerCase() ?? 'info', base: { service } });
}
export function getServiceName(): string { return serviceName; }
export function requestLogger(logger: Logger, requestId: string, tenantId?: string): Logger {
  return logger.child({ request_id: requestId, ...(tenantId ? { tenant_id: tenantId } : {}) });
}
