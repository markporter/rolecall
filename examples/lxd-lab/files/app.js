// Sample application served behind the nginx reverse proxy on the `app` host.
//
// Runs on port 3000 and talks to PostgreSQL using process env vars (PGHOST /
// PGDATABASE / PGUSER / PGPASSWORD). The bundled `pg` driver is optional: if it
// cannot be required we log a diagnostic and still serve `/health`, so the app
// stays reachable for the proxy smoke-test even without a working database.
//
// Deployed by configure.yaml onto /opt/rolecall-app/app.js via the RoleCall `file` module.

const http = require('http');

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

// Optional native-ish driver; degrade gracefully when absent (apt nodejs does
// not ship `pg`). A missing require() must never crash the process at load time.
let pg;
try {
  // eslint-disable-next-line global-require
  pg = require('pg');
} catch (err) {
  console.error('[app] pg driver unavailable:', err.message);
  pg = null;
}

const dbConfig = {
  host: process.env.PGHOST || '10.200.100.2',
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || 'appdb',
  username: process.env.PGUSER || 'appuser',
  password: process.env.PGPASSWORD || '',
};

async function fetchRow() {
  if (!pg) {
    return { ok: false, error: 'pg driver not installed', pg: null };
  }
  const client = new pg.Client(dbConfig);
  try {
    await client.connect();
    const res = await client.query('SELECT now() AS current_time, $1::text AS connected_as', [
      dbConfig.username,
    ]);
    return { ok: true, pg: res.rows[0] };
  } catch (err) {
    return { ok: false, error: String(err.message), pg: null };
  } finally {
    await client.end().catch(() => undefined);
  }
}

const server = http.createServer(async (req, res) => {
  const send = (status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(body);
  };

  if (req.url === '/health') {
    return send(200, { ok: true });
  }

  if (req.url === '/' || req.url.startsWith('/api')) {
    const result = await fetchRow();
    return send(result.ok ? 200 : 503, result);
  }

  send(404, { ok: false, error: 'not found' });
});

server.listen(PORT, () => {
  console.log(`[app] listening on port ${PORT}`);
});
