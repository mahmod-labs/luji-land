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

  const port = Number(env.PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`PORT must be a positive integer, got: ${env.PORT}`);
  }

  // A broker address has a sane local default (like PORT), so it doesn't gate
  // boot the way the database URL does — the publisher retries a down broker
  // rather than the process refusing to start.
  const kafkaBrokers = (env.KAFKA_BROKERS ?? 'localhost:9092')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean);

  return { port, databaseUrl, kafkaBrokers };
}
