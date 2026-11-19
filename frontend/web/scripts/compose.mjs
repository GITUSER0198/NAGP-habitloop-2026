import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cwd = fileURLToPath(new URL('../../../', import.meta.url));
const action = process.argv[2];
if (!['start', 'stop'].includes(action)) throw new Error('Use start or stop.');
// Build succeeds before Compose replaces a running web container.
if (action === 'start') {
  const build = spawnSync('docker', ['compose', 'build', 'web'], { cwd, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}
const args = action === 'start' ? ['compose', 'up', '-d', '--no-deps', '--wait', 'web'] : ['compose', 'stop', 'web'];
const result = spawnSync('docker', args, { cwd, stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
if (action === 'start') {
  const port = spawnSync('docker', ['compose', 'port', 'web', '47809'], { cwd, encoding: 'utf8' });
  const published = port.stdout?.trim().split(':').at(-1);
  console.log(`HabitLoop is ready at http://localhost:${published}. Use npm run stop to stop the web app. Logs: docker compose logs web.`);
} else console.log('HabitLoop web stopped.');
