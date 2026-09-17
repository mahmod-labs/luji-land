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

  it('picks exactly one winner among 10 concurrent enrollments for 1 remaining seat', async () => {
    const classroomId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { id: classroomId, name: 'Daisies', capacity: 20 },
    });

    for (let i = 0; i < 19; i++) {
      const res = await enroll(await makeChild(), classroomId);
      expect(res.statusCode).toBe(201);
    }

    const children = await Promise.all(Array.from({ length: 10 }, () => makeChild()));
    const results = await Promise.all(children.map((c) => enroll(c, classroomId)));

    const winners = results.filter((r) => r.statusCode === 201);
    const losers = results.filter((r) => r.statusCode === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(9);

    const count = await prisma.enrollment.count({ where: { classroomId } });
    expect(count).toBe(20);
  }, 60_000);

  it('fills a small room exactly to capacity sequentially, then rejects the next', async () => {
    const classroomId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { id: classroomId, name: 'Tulips', capacity: 3 },
    });

    for (let i = 0; i < 3; i++) {
      const res = await enroll(await makeChild(), classroomId);
      expect(res.statusCode).toBe(201);
    }

    const overflow = await enroll(await makeChild(), classroomId);
    expect(overflow.statusCode).toBe(409);

    const count = await prisma.enrollment.count({ where: { classroomId } });
    expect(count).toBe(3);
  }, 60_000);

  it('does not let two different rooms contend at their own last seat', async () => {
    const roomA = randomUUID();
    const roomB = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { id: roomA, name: 'Roses', capacity: 1 },
    });
    await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { id: roomB, name: 'Lilies', capacity: 1 },
    });

    const [childA, childB] = await Promise.all([makeChild(), makeChild()]);
    const [resA, resB] = await Promise.all([
      enroll(childA, roomA),
      enroll(childB, roomB),
    ]);

    // Independent rooms lock independently — both must succeed. If the lock
    // were global instead of per-classroom, this would still pass by luck
    // some of the time, but a serialized/global lock would show up as one
    // of the two unexpectedly failing under heavier concurrent load; the
    // capacity=1 setup here at least proves they don't share a "room full"
    // outcome with each other.
    expect(resA.statusCode).toBe(201);
    expect(resB.statusCode).toBe(201);

    expect(await prisma.enrollment.count({ where: { classroomId: roomA } })).toBe(1);
    expect(await prisma.enrollment.count({ where: { classroomId: roomB } })).toBe(1);
  }, 60_000);

  it('leaves no partial row behind when a 409 is returned', async () => {
    const classroomId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/classrooms',
      payload: { id: classroomId, name: 'Orchids', capacity: 1 },
    });

    const first = await enroll(await makeChild(), classroomId);
    expect(first.statusCode).toBe(201);
    const before = await prisma.enrollment.count({ where: { classroomId } });

    const rejected = await enroll(await makeChild(), classroomId);
    expect(rejected.statusCode).toBe(409);

    const after = await prisma.enrollment.count({ where: { classroomId } });
    expect(after).toBe(before);
    expect(after).toBe(1);
  }, 60_000);
});
