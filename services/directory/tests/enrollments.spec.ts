import { randomUUID } from 'node:crypto';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { startTestApp, stopTestApp } from './app';

describe('Directory /enrollments capacity (real Postgres via Testcontainers)', () => {
  let app: NestFastifyApplication;
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ app, container } = await startTestApp());
    prisma = new PrismaClient({
      datasources: { db: { url: container.getConnectionUri() } },
    });
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await stopTestApp(app, container);
  });

  async function makeChild(): Promise<string> {
    const id = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/children',
      payload: { id, firstName: 'Kid', lastName: id.slice(0, 8) },
    });
    return id;
  }

  function enroll(childId: string, classroomId: string) {
    return app.inject({
      method: 'POST',
      url: '/enrollments',
      payload: { id: randomUUID(), childId, classroomId },
    });
  }

  it('holds capacity=20 under a concurrent 20th and 21st enrollment', async () => {
    const classroomId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { id: classroomId, name: 'Sunflowers', capacity: 20 },
    });

    // Fill 19 sequentially, leaving exactly one seat.
    for (let i = 0; i < 19; i++) {
      const res = await enroll(await makeChild(), classroomId);
      expect(res.statusCode).toBe(201);
    }

    // The 20th and 21st race for the last seat, at the same time.
    const [a, b] = await Promise.all([
      enroll(await makeChild(), classroomId),
      enroll(await makeChild(), classroomId),
    ]);

    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 409]);

    const count = await prisma.enrollment.count({ where: { classroomId } });
    expect(count).toBe(20);
  }, 60_000);
});
