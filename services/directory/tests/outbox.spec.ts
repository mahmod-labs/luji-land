import { randomUUID } from 'node:crypto';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { KafkaContainer, StartedKafkaContainer } from '@testcontainers/kafka';
import { PrismaClient } from '@prisma/client';
import { Kafka, type Consumer } from 'kafkajs';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { startTestApp, stopTestApp } from './app';
import enrolledSchema from '../../../contracts/directory/child.enrolled.v1.json';

const ajv = new Ajv();
addFormats(ajv);
const validateEnrolled = ajv.compile(enrolledSchema);

describe('Directory transactional outbox + publisher (real Postgres + real Kafka)', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let kafkaContainer: StartedKafkaContainer;
  let databaseUrl: string;
  let brokers: string[];
  let prisma: PrismaClient;

  beforeAll(async () => {
    const boot = await startTestApp();
    // We only needed startTestApp once to run migrations against a fresh DB;
    // close this throwaway app immediately — real tests below build their
    // own app instances with KAFKA_BROKERS pointed where each case needs.
    pgContainer = boot.container!;
    databaseUrl = boot.databaseUrl;
    await boot.app.close();

    kafkaContainer = await new KafkaContainer('confluentinc/cp-kafka:7.6.0').start();
    brokers = [`${kafkaContainer.getHost()}:${kafkaContainer.getMappedPort(9093)}`];

    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  }, 180_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await kafkaContainer.stop();
    await pgContainer.stop();
  });

  async function makeChild(app: NestFastifyApplication): Promise<string> {
    const id = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/children',
      payload: { id, firstName: 'Kid', lastName: id.slice(0, 8) },
    });
    return id;
  }

  function enroll(app: NestFastifyApplication, childId: string, classroomId: string) {
    return app.inject({
      method: 'POST',
      url: '/enrollments',
      payload: { id: randomUUID(), childId, classroomId },
    });
  }

  it('writes exactly one outbox row for a successful enrollment, zero for a capacity rejection', async () => {
    const { app, container } = await startTestApp({
      databaseUrl,
      kafkaBrokers: brokers.join(','),
      runMigrations: false,
    });
    try {
      const classroomId = randomUUID();
      await app.inject({
        method: 'POST',
        url: '/classrooms',
        payload: { id: classroomId, name: 'Atomicity', capacity: 1 },
      });

      const enrolledCount = () =>
        prisma.outboxEvent.count({ where: { topic: 'directory.child.enrolled' } });
      const before = await enrolledCount();

      const first = await enroll(app, await makeChild(app), classroomId);
      expect(first.statusCode).toBe(201);

      const afterFirst = await enrolledCount();
      expect(afterFirst - before).toBe(1);

      const rejected = await enroll(app, await makeChild(app), classroomId);
      expect(rejected.statusCode).toBe(409);

      // A rolled-back domain write must leave NO outbox row behind — the
      // capacity trigger and the outbox append share one transaction.
      const afterRejected = await enrolledCount();
      expect(afterRejected).toBe(afterFirst);
    } finally {
      await stopTestApp(app, container ?? undefined);
    }
  }, 60_000);

  it('drains an appended event to the real topic, matches the contract, and stamps sentAt only after the broker ack', async () => {
    const { app, container } = await startTestApp({
      databaseUrl,
      kafkaBrokers: brokers.join(','),
      runMigrations: false,
    });
    try {
      const classroomId = randomUUID();
      await app.inject({
        method: 'POST',
        url: '/classrooms',
        payload: { id: classroomId, name: 'Publisher', capacity: 5 },
      });
      const childId = await makeChild(app);
      const res = await enroll(app, childId, classroomId);
      expect(res.statusCode).toBe(201);
      const enrollmentId = res.json().id;

      const outboxRow = await prisma.outboxEvent.findFirst({
        where: { key: childId, topic: 'directory.child.enrolled' },
      });
      expect(outboxRow).not.toBeNull();
      expect(outboxRow!.sentAt).toBeNull(); // not drained yet — publisher polls every 1s

      const kafka = new Kafka({ clientId: 'test-consumer', brokers });
      const consumer: Consumer = kafka.consumer({ groupId: `test-${randomUUID()}` });
      await consumer.connect();
      await consumer.subscribe({ topic: 'directory.child.enrolled', fromBeginning: true });

      const received = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out waiting for event')), 20_000);
        void consumer.run({
          eachMessage: async ({ message }) => {
            const value = JSON.parse(message.value!.toString());
            if (value.enrollmentId === enrollmentId) {
              clearTimeout(timeout);
              resolve(value);
            }
          },
        });
      });
      await consumer.disconnect();

      expect(received.eventId).toBe(outboxRow!.id);
      expect(received.childId).toBe(childId);
      expect(received.classroomId).toBe(classroomId);
      expect(typeof received.occurredAt).toBe('string');

      // sentAt is only stamped after the send() promise (the broker ack)
      // resolves — by now the consumer already saw it, so it must be set.
      const sentRow = await prisma.outboxEvent.findUnique({ where: { id: outboxRow!.id } });
      expect(sentRow!.sentAt).not.toBeNull();
    } finally {
      await stopTestApp(app, container ?? undefined);
    }
  }, 60_000);

  it('validates the published payload against the child.enrolled.v1 contract', async () => {
    const { app, container } = await startTestApp({
      databaseUrl,
      kafkaBrokers: brokers.join(','),
      runMigrations: false,
    });
    try {
      const classroomId = randomUUID();
      await app.inject({
        method: 'POST',
        url: '/classrooms',
        payload: { id: classroomId, name: 'Contract', capacity: 5 },
      });
      const childId = await makeChild(app);
      const res = await enroll(app, childId, classroomId);
      const enrollmentId = res.json().id;

      const kafka = new Kafka({ clientId: 'test-consumer-2', brokers });
      const consumer = kafka.consumer({ groupId: `test-${randomUUID()}` });
      await consumer.connect();
      await consumer.subscribe({ topic: 'directory.child.enrolled', fromBeginning: true });

      const received = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out waiting for event')), 20_000);
        void consumer.run({
          eachMessage: async ({ message }) => {
            const value = JSON.parse(message.value!.toString());
            if (value.enrollmentId === enrollmentId) {
              clearTimeout(timeout);
              resolve(value);
            }
          },
        });
      });
      await consumer.disconnect();

      const valid = validateEnrolled(received);
      expect(valid).toBe(true);
      if (!valid) {
        // Surface ajv's errors in the failure message rather than a bare false.
        throw new Error(JSON.stringify(validateEnrolled.errors));
      }
    } finally {
      await stopTestApp(app, container ?? undefined);
    }
  }, 60_000);

  it('accepts writes and accumulates unsent outbox rows while the broker is unreachable, then drains once reachable', async () => {
    // Simulates the broker being down: point this app instance's producer at
    // an address nothing is listening on. The domain write must still
    // succeed and the outbox row must still be written — the outbox exists
    // precisely so a down broker never blocks or loses a write.
    const down = await startTestApp({
      databaseUrl,
      kafkaBrokers: 'localhost:1',
      runMigrations: false,
    });
    let childId: string;
    let enrollmentId: string;
    try {
      const classroomId = randomUUID();
      await down.app.inject({
        method: 'POST',
        url: '/classrooms',
        payload: { id: classroomId, name: 'Outage', capacity: 5 },
      });
      childId = await makeChild(down.app);
      const res = await enroll(down.app, childId, classroomId);
      expect(res.statusCode).toBe(201);
      enrollmentId = res.json().id;

      // Give the publisher a few failed ticks against the dead broker.
      await new Promise((r) => setTimeout(r, 3_000));

      const row = await prisma.outboxEvent.findFirst({
        where: { key: childId, topic: 'directory.child.enrolled' },
      });
      expect(row).not.toBeNull();
      expect(row!.sentAt).toBeNull();
    } finally {
      await stopTestApp(down.app, undefined); // shared DB container stays up
    }

    // Broker is reachable again — start a fresh app instance against the
    // SAME database, pointed at the real Kafka container, and let its
    // publisher loop drain the accumulated row.
    const up = await startTestApp({
      databaseUrl,
      kafkaBrokers: brokers.join(','),
      runMigrations: false,
    });
    try {
      const kafka = new Kafka({ clientId: 'test-consumer-3', brokers });
      const consumer = kafka.consumer({ groupId: `test-${randomUUID()}` });
      await consumer.connect();
      await consumer.subscribe({ topic: 'directory.child.enrolled', fromBeginning: true });

      const received = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('timed out waiting for drained event')), 20_000);
        void consumer.run({
          eachMessage: async ({ message }) => {
            const value = JSON.parse(message.value!.toString());
            if (value.enrollmentId === enrollmentId) {
              clearTimeout(timeout);
              resolve(value);
            }
          },
        });
      });
      await consumer.disconnect();

      expect(received.childId).toBe(childId);

      const row = await prisma.outboxEvent.findFirst({
        where: { key: childId, topic: 'directory.child.enrolled' },
      });
      expect(row!.sentAt).not.toBeNull();
    } finally {
      await stopTestApp(up.app, undefined);
    }
  }, 60_000);
});
