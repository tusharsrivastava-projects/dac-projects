import { config } from '../config.js';
import { bootstrap, wipe } from './bootstrap.js';

const reset = process.argv.includes('--reset');

if (reset) {
  wipe();
  console.log('• wiped existing data');
}

const result = bootstrap({ demo: 'full' });

console.log(`• admin ${result.adminCreated ? 'created' : 'already present'} → ${config.seedAdmin.email}`);
if (result.adminCreated) console.log(`  password: ${config.seedAdmin.password}`);
if (result.candidate) console.log('• demo candidate → aarav.demo@dgu.ac.in / candidate123');
console.log(`• ${result.jobs} role(s) added`);
console.log(`• ${result.questions} interview question(s) added`);
console.log(`\nSeed complete. Run \`npm start\` and open http://localhost:${config.port}`);
