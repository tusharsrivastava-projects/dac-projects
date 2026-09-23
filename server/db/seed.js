import { config } from '../config.js';
import { KNOWN_DEFAULT_PASSWORDS, bootstrap, wipe } from './bootstrap.js';

const reset = process.argv.includes('--reset');
// Sample roles, questions and a demo candidate. Off unless you ask, so a real
// install never shows candidates openings nobody actually posted.
const demo = process.argv.includes('--demo') || process.env.SEED_DEMO_DATA === 'true';

if (reset) {
  wipe();
  console.log('• wiped existing data');
}

const result = bootstrap({ demo: demo ? 'full' : false });

console.log(`• admin ${result.adminCreated ? 'created' : 'already present'} → ${config.seedAdmin.email}`);
if (result.adminCreated) {
  // Only ever echo a password that is already public in the repo. A real one
  // set through ADMIN_PASSWORD must not end up in a terminal scrollback or,
  // worse, a hosting provider's deploy log.
  console.log(KNOWN_DEFAULT_PASSWORDS.has(config.seedAdmin.password)
    ? `  password: ${config.seedAdmin.password}  ← the repo default, change it`
    : '  password: taken from ADMIN_PASSWORD (not printed)');
}
if (result.candidate) console.log('• demo candidate → aarav.demo@dgu.ac.in / candidate123');
if (demo) {
  console.log(`• ${result.jobs} sample role(s) added`);
  console.log(`• ${result.questions} sample interview question(s) added`);
} else {
  console.log('• no roles or questions — post them from the admin console');
  console.log('  (run `npm run seed -- --demo` if you want the sample hiring round)');
}
console.log(`\nSeed complete. Run \`npm start\` and open http://localhost:${config.port}`);
