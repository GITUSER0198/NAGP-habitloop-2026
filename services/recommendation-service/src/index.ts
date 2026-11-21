import { createApp, getConfig } from '@habitloop/shared';
import { initializeRecommendationTables } from './db/init.js';
import { registerRecommendationRoutes } from './routes/recommendations.js';

const app = await createApp('recommendation-service', '/api/recommendations');
await app.register(async service => registerRecommendationRoutes(service), { prefix: '/api/recommendations' });
app.addHook('onReady', initializeRecommendationTables);
await app.listen({ host: '0.0.0.0', port: getConfig().servicePort });
