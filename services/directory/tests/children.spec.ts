import { randomUUID } from 'node:crypto';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { startTestApp, stopTestApp } from './app';

describe('Directory /children (real Postgres via Testcontainers)', () => {
  let app: NestFastifyApplication;
  let container: StartedPostgreSqlContainer;

  beforeAll(async () => {
    ({ app, container } = await startTestApp());
  }, 120_000);

  afterAll(async () => {
    await stopTestApp(app, container);
  });

  it('creates a child with a client-supplied UUID and reads it back identical', async () => {
    const id = randomUUID();
    const create = await app.inject({
      method: 'POST',
      url: '/children',
      payload: { id, firstName: 'Ada', lastName: 'Lovelace' },
    });

    expect(create.statusCode).toBe(201);
    const created = create.json();

    const read = await app.inject({ method: 'GET', url: `/children/${id}` });
    expect(read.statusCode).toBe(200);
    const found = read.json();

    // The stored id equals the caller-supplied UUID exactly — slice 4's
    // events carry this id, so it must not be regenerated or normalized.
    expect(found.id).toBe(id);
    expect(found.firstName).toBe('Ada');
    expect(found.lastName).toBe('Lovelace');
    expect(found).toEqual(created);
  });

  it('sets and persists a createdAt timestamp on creation', async () => {
    const id = randomUUID();
    const before = Date.now();

    const create = await app.inject({
      method: 'POST',
      url: '/children',
      payload: { id, firstName: 'Grace', lastName: 'Hopper' },
    });
    expect(create.statusCode).toBe(201);
    const after = Date.now();

    const createdAtMs = new Date(create.json().createdAt).getTime();
    expect(Number.isNaN(createdAtMs)).toBe(false);
    expect(createdAtMs).toBeGreaterThanOrEqual(before - 1000); // clock slack
    expect(createdAtMs).toBeLessThanOrEqual(after + 1000);

    // Persisted, not just returned on the create response.
    const read = await app.inject({ method: 'GET', url: `/children/${id}` });
    expect(read.json().createdAt).toBe(create.json().createdAt);
  });

  it('rejects a non-UUID id with 400 and writes nothing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/children',
      payload: { id: 'not-a-uuid', firstName: 'Bad', lastName: 'Id' },
    });
    expect(res.statusCode).toBe(400);

    // Nothing should have been written under any id we can query for.
    const read = await app.inject({
      method: 'GET',
      url: '/children/not-a-uuid',
    });
    expect(read.statusCode).toBe(404);
  });

  it('rejects a malformed body (missing required fields) with 400 and writes nothing', async () => {
    const id = randomUUID();
    const res = await app.inject({
      method: 'POST',
      url: '/children',
      payload: { id },
    });
    expect(res.statusCode).toBe(400);

    const read = await app.inject({ method: 'GET', url: `/children/${id}` });
    expect(read.statusCode).toBe(404);
  });

  it('returns 404 for a well-formed but unknown UUID', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/children/${randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
  });
});
