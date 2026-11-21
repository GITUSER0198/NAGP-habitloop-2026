export type AppConfig = {
  jwtSecret: Uint8Array;
  internalToken: string;
  databaseUrl: string;
  dbSchema: string;
  servicePort: number;
  eventBusMode: 'local' | 'aws';
  eventBusName: string;
  eventWorkerUrl: string;
  awsRegion: string;
  logLevel: string;
  webPort?: number;
};

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret?.trim()) throw new Error('JWT_SECRET must be set and nonempty');
  const internalToken = process.env.INTERNAL_TOKEN;
  if (!internalToken?.trim()) throw new Error('INTERNAL_TOKEN must be set and nonempty');
  const rawDatabaseUrl = process.env.DATABASE_URL;
  if (!rawDatabaseUrl?.trim()) throw new Error('DATABASE_URL must be set and nonempty');
  const dbSchema = process.env.DB_SCHEMA ?? 'public';
  if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) throw new Error('DB_SCHEMA must be a lowercase SQL identifier');
  const eventBusMode = process.env.EVENT_BUS_MODE ?? 'local';
  if (eventBusMode !== 'local' && eventBusMode !== 'aws') throw new Error('EVENT_BUS_MODE must be local or aws');
  const servicePort = Number(process.env.SERVICE_PORT ?? 47820);
  if (!Number.isInteger(servicePort) || servicePort < 1 || servicePort > 65535) throw new Error('SERVICE_PORT is invalid');
  const webPort = process.env.WEB_PORT ? Number(process.env.WEB_PORT) : undefined;
  cached = {
    jwtSecret: new TextEncoder().encode(jwtSecret),
    internalToken,
    // Older env files carry a driver-qualified URL (postgresql+psycopg://). node-postgres wants a plain URI.
    databaseUrl: rawDatabaseUrl.replace(/^postgresql\+psycopg:\/\//, 'postgresql://').replace(/^postgres\+psycopg:\/\//, 'postgres://'),
    dbSchema,
    servicePort,
    eventBusMode,
    eventBusName: process.env.EVENT_BUS_NAME ?? 'default',
    eventWorkerUrl: process.env.EVENT_WORKER_URL ?? `http://event-worker:${servicePort}/events`,
    awsRegion: process.env.AWS_REGION ?? 'ap-south-1',
    logLevel: process.env.LOG_LEVEL ?? 'info',
    ...(webPort ? { webPort } : {})
  };
  return cached;
}

export function resetConfigForTests(): void { cached = undefined; }
