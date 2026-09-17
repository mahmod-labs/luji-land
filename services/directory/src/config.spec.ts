import assert from 'node:assert';
import { loadConfig } from './config';

// Rule 6: missing DATABASE_URL must refuse to boot.
assert.throws(() => loadConfig({} as NodeJS.ProcessEnv), /DIRECTORY_DATABASE_URL/);

// Rule 6: missing KAFKA_BROKERS must refuse to boot (presence, not reachability).
assert.throws(
  () =>
    loadConfig({
      DIRECTORY_DATABASE_URL: 'postgresql://x',
    } as NodeJS.ProcessEnv),
  /KAFKA_BROKERS/,
);

const cfg = loadConfig({
  DIRECTORY_DATABASE_URL: 'postgresql://x',
  KAFKA_BROKERS: 'localhost:9092',
} as NodeJS.ProcessEnv);
assert.equal(cfg.port, 3001);
assert.equal(cfg.databaseUrl, 'postgresql://x');
assert.deepEqual(cfg.kafkaBrokers, ['localhost:9092']);

assert.throws(
  () =>
    loadConfig({
      DIRECTORY_DATABASE_URL: 'postgresql://x',
      KAFKA_BROKERS: 'localhost:9092',
      PORT: 'nope',
    } as NodeJS.ProcessEnv),
  /PORT/,
);

console.log('config self-check passed');
