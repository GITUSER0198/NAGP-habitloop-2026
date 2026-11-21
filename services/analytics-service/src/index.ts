import { createApp, getConfig } from '@habitloop/shared';
import { registerAnalyticsRoutes } from './routes/analytics.js';

const app = await createApp('analytics-service', '/api/analytics');
await app.register(async service => registerAnalyticsRoutes(service), { prefix: '/api/analytics' });
await app.listen({ host: '0.0.0.0', port: getConfig().servicePort });
