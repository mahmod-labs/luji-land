// Rule 6: a missing setting refuses to boot. Parsed once, here, at startup.
export type Config = {
  port: number;
  databaseUrl: string;
  kafkaBrokers: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DIRECTORY_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DIRECTORY_DATABASE_URL is required');
  }

  // PORT keeps a default: it's the service's own listen port, not a dependency
  // address, and 3001 is the fixed convention across compose and the README.
  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got: ${env.PORT}`);
  }

  // Rule 6: a missing broker address refuses to boot, no default. (This is the
  // setting's presence, not the broker's reachability — the OutboxPublisher
  // still reconnects to a down broker at runtime.)
  if (!env.KAFKA_BROKERS) {
    throw new Error('KAFKA_BROKERS is required');
  }
  const kafkaBrokers = env.KAFKA_BROKERS.split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  return { port, databaseUrl, kafkaBrokers };
}
