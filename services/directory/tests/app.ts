import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

// Boots the Directory service against a real, disposable Postgres —
// same migrations, same Nest wiring the real service uses.
export async function startTestApp(options?: {
  databaseUrl?: string;
  kafkaBrokers?: string;
  runMigrations?: boolean;
}): Promise<{
  app: NestFastifyApplication;
  container: StartedPostgreSqlContainer | undefined;
  databaseUrl: string;
}> {
  let container: StartedPostgreSqlContainer | undefined;
  let databaseUrl = options?.databaseUrl;

  if (!databaseUrl) {
    container = await new PostgreSqlContainer('postgres:17').start();
    databaseUrl = container.getConnectionUri();
  }

  if (options?.runMigrations !== false) {
    execSync('npx prisma migrate deploy', {
      cwd: __dirname + '/..',
      env: { ...process.env, DIRECTORY_DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
  }

  process.env.DIRECTORY_DATABASE_URL = databaseUrl;
  // Reused across app instances pointed at the same DB (e.g. a "broker down
  // then up" sequence) — set fresh before each create(), since the outbox
  // publisher reads it once, at construction.
  if (options?.kafkaBrokers) {
    process.env.KAFKA_BROKERS = options.kafkaBrokers;
  }
  // AppModule imports read env at construction time via PrismaService below.
  const { AppModule } = await import('../src/app.module');

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, container, databaseUrl };
}

export async function stopTestApp(
  app: INestApplication,
  container?: StartedPostgreSqlContainer,
): Promise<void> {
  await app.close();
  await container?.stop();
}
