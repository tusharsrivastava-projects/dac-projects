import { config } from '../config.js';
import { KNOWN_DEFAULT_PASSWORDS, bootstrap, wipe } from './bootstrap.js';

const reset = process.argv.includes('--reset');

if (reset) {
  wipe();
  console.log('• wiped existing data');
}

const result = bootstrap({ demo: 'full' });

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
console.log(`• ${result.jobs} role(s) added`);
console.log(`• ${result.questions} interview question(s) added`);
console.log(`\nSeed complete. Run \`npm start\` and open http://localhost:${config.port}`);
