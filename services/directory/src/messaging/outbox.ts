import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Producer } from 'kafkajs';
import { loadConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { createProducer } from './producer';

type NewEvent = {
  topic: string;
  key: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

// Append an event in the caller's transaction. The domain write and this row
// commit together or not at all — that atomicity is the whole point of the
// outbox, so this MUST be called with the same tx client as the domain write.
export function appendOutbox(
  tx: Prisma.TransactionClient,
  event: NewEvent,
): Promise<unknown> {
  return tx.outboxEvent.create({
    data: {
      id: randomUUID(),
      topic: event.topic,
      key: event.key,
      payload: event.payload as Prisma.InputJsonValue,
      occurredAt: event.occurredAt,
    },
  });
}

const POLL_MS = 1000;
const BATCH = 100;

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private readonly producer: Producer;
  private connected = false;
  private draining = false;
  private timer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {
    this.producer = createProducer(loadConfig().kafkaBrokers);
  }

  onModuleInit(): void {
    // A down broker must not stop the service from accepting writes — the rows
    // wait in the outbox and drain once the broker is back (rule 3).
    this.timer = setInterval(() => void this.drain(), POLL_MS);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    if (this.connected) {
      await this.producer.disconnect().catch(() => undefined);
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return; // one tick at a time; a slow send must not overlap
    this.draining = true;
    try {
      if (!this.connected) {
        await this.producer.connect();
        this.connected = true;
      }

      // Oldest-first so events leave in occurrence order. One row at a time,
      // stamping sentAt after each ack: a crash mid-batch re-sends only the
      // unstamped tail (at-least-once; the consumer is idempotent).
      const rows = await this.prisma.outboxEvent.findMany({
        where: { sentAt: null },
        orderBy: { occurredAt: 'asc' },
        take: BATCH,
      });

      for (const row of rows) {
        const envelope = {
          eventId: row.id,
          occurredAt: row.occurredAt.toISOString(),
          ...(row.payload as Record<string, unknown>),
        };
        await this.producer.send({
          topic: row.topic,
          messages: [{ key: row.key, value: JSON.stringify(envelope) }],
        });
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { sentAt: new Date() },
        });
      }
    } catch (err) {
      // Broker or DB blip: drop the connection so the next tick reconnects, and
      // leave unsent rows unsent. Nothing is lost, the loop just retries.
      this.connected = false;
      this.logger.warn(
        `outbox drain failed, will retry: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.draining = false;
    }
  }
}

@Module({
  providers: [OutboxPublisher],
})
export class MessagingModule {}
