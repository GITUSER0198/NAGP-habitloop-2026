import { createApp, getConfig } from '@habitloop/shared';
import { initializeChallengeTables } from './db/init.js';
import { registerChallengeRoutes } from './routes/challenges.js';

const app = await createApp('challenge-service', '/api/challenges');
await app.register(async service => registerChallengeRoutes(service), { prefix: '/api/challenges' });
app.addHook('onReady', initializeChallengeTables);
await app.listen({ host: '0.0.0.0', port: getConfig().servicePort });
