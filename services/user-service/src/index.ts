import { createApp, getConfig } from '@habitloop/shared';
import { initializeUserTables } from './db/init.js';
import { backfillOrganizations } from './organization.js';
import { registerUserRoutes } from './routes/users.js';

const app = await createApp('user-service', '/api/users');
await app.register(async service => registerUserRoutes(service), { prefix: '/api/users' });
app.addHook('onReady', async () => { await initializeUserTables(); await backfillOrganizations(); });

await app.listen({ host: '0.0.0.0', port: getConfig().servicePort });
