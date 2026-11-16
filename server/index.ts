import { resolve, join } from 'node:path';
import { createApp } from './app.js';
import { registerMedia } from './media.js';
import { registerOperations } from './operations.js';

const port = Number(process.env.PORT ?? 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT muss eine gültige Portnummer sein.');
const dataDir = resolve(process.env.DATA_DIR ?? join(process.cwd(),'.runtime','data'));
const ctx = createApp({
  dataDir,
  origin:process.env.APP_ORIGIN,
  secureCookies:process.env.SECURE_COOKIES === undefined ? undefined : process.env.SECURE_COOKIES === 'true',
  allowSetup:process.env.ALLOW_SETUP !== 'false',
  distDir:resolve('dist'),
  registerExtras(context) { registerMedia(context); registerOperations(context); },
});
const server = ctx.app.listen(port,'127.0.0.1',() => console.log(`Unser Zuhause läuft auf http://127.0.0.1:${port} (nur lokaler Backend-Zugang).`));
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => {ctx.db.close();process.exit(0);});
  setTimeout(() => process.exit(1),10_000).unref();
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
