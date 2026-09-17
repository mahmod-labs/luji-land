import { Kafka, type Producer } from 'kafkajs';

// One Kafka producer for the service. acks defaults to -1 (all in-sync
// replicas) — the publisher marks an outbox row sent only after send()
// resolves, so "sent" means the broker actually has it.
export function createProducer(brokers: string[]): Producer {
  const kafka = new Kafka({ clientId: 'directory', brokers });
  return kafka.producer();
}
