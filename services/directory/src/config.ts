// Rule 6: a missing setting refuses to boot. Parsed once, here, at startup.
export type Config = {
  port: number;
  databaseUrl: string;
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

  return { port, databaseUrl };
}
