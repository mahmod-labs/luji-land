-- Transactional outbox. Written in the same transaction as the domain row it
-- describes, so an event can never outlive a rolled-back write nor a write
-- commit without its event. Drained to Kafka by the publisher loop.
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- The publisher scans unsent rows (sentAt IS NULL) oldest-first; this index
-- keeps that scan off a full table as sent rows accumulate.
CREATE INDEX "OutboxEvent_sentAt_occurredAt_idx" ON "OutboxEvent"("sentAt", "occurredAt");
