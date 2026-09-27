/**
 * npm run seed            baseline + demo catalogue (skips if data exists)
 * npm run seed -- --empty baseline only: categories, areas, admin
 * npm run reset           wipes the database and uploads, then seeds the demo
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const empty = args.includes('--empty');

if (reset) {
  for (const f of [config.dbFile, `${config.dbFile}-wal`, `${config.dbFile}-shm`]) fs.rmSync(f, { force: true });
  for (const dir of ['services', 'avatars', 'private']) fs.rmSync(path.join(config.uploadDir, dir), { recursive: true, force: true });
  console.log('Wiped the database and uploads.');
}

const { db } = await import('./index.js');
const { baseline, demo } = await import('./bootstrap.js');

const hasServices = db.prepare('SELECT COUNT(*) AS n FROM services').get().n > 0;
baseline();
if (empty) {
  console.log(`Baseline ready. Admin: ${config.seedAdmin.email}`);
} else if (hasServices) {
  console.log('Services already exist; left the catalogue alone. Use `npm run reset` for a fresh demo.');
} else {
  const r = demo();
  console.log(`Seeded ${r.services} demo services with listers, members, payments and settlements.`);
  console.log(`  Admin     ${config.seedAdmin.email} / ${process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : config.seedAdmin.password}`);
  console.log('  Lister    lister@subtize.ai / lister12345   (Meera, awaiting e-sign: meera@subtize.ai / lister12345)');
  console.log('  Explorer  priya@subtize.ai / demo12345');
}
db.close();
