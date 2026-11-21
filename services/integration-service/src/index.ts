import { createApp, getConfig } from '@habitloop/shared';
import { initializeIntegrationTables } from './db/init.js';
import { registerRawBodyParser } from './raw-body.js';
import { registerIntegrationRoutes } from './routes/integrations.js';

const app = await createApp('integration-service', '/api/integrations');
registerRawBodyParser(app);
await app.register(async service => registerIntegrationRoutes(service), { prefix: '/api/integrations' });
app.addHook('onReady', initializeIntegrationTables);
await app.listen({ host: '0.0.0.0', port: getConfig().servicePort });
