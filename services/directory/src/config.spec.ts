import assert from 'node:assert';
import { loadConfig } from './config';

// Rule 6: missing DATABASE_URL must refuse to boot.
assert.throws(() => loadConfig({} as NodeJS.ProcessEnv), /DIRECTORY_DATABASE_URL/);

const cfg = loadConfig({
  DIRECTORY_DATABASE_URL: 'postgresql://x',
} as NodeJS.ProcessEnv);
assert.equal(cfg.port, 3001);
assert.equal(cfg.databaseUrl, 'postgresql://x');

assert.throws(
  () =>
    loadConfig({
      DIRECTORY_DATABASE_URL: 'postgresql://x',
      PORT: 'nope',
    } as NodeJS.ProcessEnv),
  /PORT/,
);

console.log('config self-check passed');
