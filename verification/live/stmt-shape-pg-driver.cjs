// Ask 4 — the RESULT ENVELOPE of the pg driver, measured rather than asserted.
// Run as the postgres OS user so peer auth over the unix socket works.
const { Client } = require('pg');
(async () => {
  const c = new Client({ host: '/var/run/postgresql', user: 'postgres', database: 'postgres' });
  await c.connect();
  await c.query('CREATE TEMP TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
  for (const [label, sql] of [
    ['INSERT', "INSERT INTO t (id,name) VALUES (1,'a')"],
    ['UPDATE', "UPDATE t SET name='b' WHERE id=1"],
    ['DELETE', 'DELETE FROM t WHERE id=1'],
    ['SELECT', 'SELECT id, name FROM t'],
  ]) {
    const r = await c.query(sql);
    console.log('  ' + label.padEnd(8), 'keys:', JSON.stringify(Object.keys(r)),
                '| rowCount:', r.rowCount, '| rows len:', r.rows.length);
  }
  await c.end();
})().catch((e) => { console.log('  FAIL', e.message); process.exit(1); });
