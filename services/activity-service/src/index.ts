import { createApp, getConfig } from '@habitloop/shared';
import { initializeActivityTables } from './db/init.js';
import { registerActivityRoutes } from './routes/activities.js';

const app = await createApp('activity-service', '/api/activities');
await app.register(async service => registerActivityRoutes(service), { prefix: '/api/activities' });
app.addHook('onReady', initializeActivityTables);
await app.listen({ host: '0.0.0.0', port: getConfig().servicePort });
