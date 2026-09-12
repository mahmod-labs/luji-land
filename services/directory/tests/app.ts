import 'reflect-metadata';
import { execSync } from 'node:child_process';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';

// Boots the Directory service against a real, disposable Postgres —
// same migrations, same Nest wiring the real service uses.
export async function startTestApp(): Promise<{
  app: NestFastifyApplication;
  container: StartedPostgreSqlContainer;
  databaseUrl: string;
}> {
  const container = await new PostgreSqlContainer('postgres:17').start();
  const databaseUrl = container.getConnectionUri();

  execSync('npx prisma migrate deploy', {
    cwd: __dirname + '/..',
    env: { ...process.env, DIRECTORY_DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });

  process.env.DIRECTORY_DATABASE_URL = databaseUrl;
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
  container: StartedPostgreSqlContainer,
): Promise<void> {
  await app.close();
  await container.stop();
}
