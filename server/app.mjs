import { Hono } from 'hono';
import { ValidationError } from './errors.mjs';
import { serveStatic } from './static.mjs';
import * as status from './controllers/status.mjs';
import * as scans from './controllers/scans.mjs';
import * as settings from './controllers/settings.mjs';
import * as screenshots from './controllers/screenshots.mjs';
import * as jobs from './controllers/jobs.mjs';
import * as ipcalc from './controllers/ipcalc.mjs';

/** Aplicación HTTP (capa View/Controller). Las rutas son delgadas: delegan en repositorios/servicios. */
export function createApp({ db, config, activeScans = new Map() }) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    c.set('db', db);
    c.set('config', config);
    c.set('activeScans', activeScans);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof ValidationError) return c.json({ error: error.message }, 400);
    console.error('[nmap-atlas]', error);
    return c.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  });

  app.get('/api/status', status.get);

  app.get('/api/settings', settings.get);
  app.put('/api/settings', settings.update);

  app.post('/api/notes/migrate', scans.migrateNotes);

  app.get('/api/scans', scans.list);
  app.post('/api/scans', scans.upload);
  app.delete('/api/scans', scans.deleteAll);
  app.get('/api/scans/:name/json', scans.getJson);
  app.patch('/api/scans/:name', scans.rename);
  app.delete('/api/scans/:name', scans.remove);
  app.put('/api/hosts/:name/:index/notes', scans.note);

  app.post('/api/scan', jobs.run);
  app.post('/api/scan/cancel', jobs.cancel);
  app.get('/api/scan/progress', jobs.progress);
  app.get('/api/jobs/:id', jobs.get);
  app.get('/api/jobs/:id/progress', jobs.progress);

  app.get('/api/screenshots', screenshots.list);
  app.get('/api/screenshots/:id/image', screenshots.image);

  app.post('/api/ipcalc', ipcalc.calculate);

  app.all('/api/*', (c) => c.json({ error: 'Endpoint no encontrado.' }, 404));

  const staticHandler = (c) => serveStatic(c, config.distDir);
  app.get('/', staticHandler);
  app.get('/*', staticHandler);

  return app;
}
