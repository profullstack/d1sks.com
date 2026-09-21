import { migrate } from './db.js';

await migrate();
process.exit(0);
