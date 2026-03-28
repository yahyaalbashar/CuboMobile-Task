import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create enums
    await queryRunner.query(`
      CREATE TYPE "call_status_enum" AS ENUM (
        'initiated', 'webrtc_answered', 'pstn_dialing',
        'pstn_answered', 'bridged', 'ended', 'failed'
      )
    `);
    await queryRunner.query(`
      CREATE TYPE "leg_type_enum" AS ENUM ('webrtc', 'pstn')
    `);
    await queryRunner.query(`
      CREATE TYPE "leg_status_enum" AS ENUM ('initiated', 'answered', 'ended', 'failed')
    `);
    await queryRunner.query(`
      CREATE TYPE "processing_status_enum" AS ENUM ('pending', 'processed', 'failed')
    `);

    // Create calls table
    await queryRunner.query(`
      CREATE TABLE "calls" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar NOT NULL,
        "sourceNumber" varchar NOT NULL,
        "destinationNumber" varchar NOT NULL,
        "status" "call_status_enum" NOT NULL DEFAULT 'initiated',
        "failureReason" varchar,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "startedAt" TIMESTAMP,
        "answeredAt" TIMESTAMP,
        "endedAt" TIMESTAMP,
        "durationSeconds" int,
        CONSTRAINT "PK_calls" PRIMARY KEY ("id")
      )
    `);

    // Create call_legs table
    await queryRunner.query(`
      CREATE TABLE "call_legs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "callId" uuid NOT NULL,
        "legType" "leg_type_enum" NOT NULL,
        "providerCallControlId" varchar NOT NULL,
        "providerSessionId" varchar,
        "status" "leg_status_enum" NOT NULL DEFAULT 'initiated',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_legs" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_call_legs_providerCallControlId" UNIQUE ("providerCallControlId"),
        CONSTRAINT "FK_call_legs_call" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE
      )
    `);

    // Create call_events table
    await queryRunner.query(`
      CREATE TABLE "call_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "callId" uuid NOT NULL,
        "legId" varchar,
        "providerEventType" varchar NOT NULL,
        "payload" jsonb NOT NULL,
        "receivedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_call_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_call_events_call" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE CASCADE
      )
    `);

    // Create webhook_deliveries table
    await queryRunner.query(`
      CREATE TABLE "webhook_deliveries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" varchar NOT NULL,
        "externalEventId" varchar NOT NULL,
        "payload" jsonb NOT NULL,
        "receivedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "processingStatus" "processing_status_enum" NOT NULL DEFAULT 'pending',
        "processedAt" TIMESTAMP,
        "errorMessage" varchar,
        CONSTRAINT "PK_webhook_deliveries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_webhook_deliveries_externalEventId" UNIQUE ("externalEventId")
      )
    `);

    // Indexes for common lookups
    await queryRunner.query(`
      CREATE INDEX "IDX_calls_status" ON "calls" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_calls_createdAt" ON "calls" ("createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_call_legs_callId" ON "call_legs" ("callId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_call_events_callId" ON "call_events" ("callId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_webhook_deliveries_processingStatus" ON "webhook_deliveries" ("processingStatus")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_deliveries"`);
    await queryRunner.query(`DROP TABLE "call_events"`);
    await queryRunner.query(`DROP TABLE "call_legs"`);
    await queryRunner.query(`DROP TABLE "calls"`);
    await queryRunner.query(`DROP TYPE "processing_status_enum"`);
    await queryRunner.query(`DROP TYPE "leg_status_enum"`);
    await queryRunner.query(`DROP TYPE "leg_type_enum"`);
    await queryRunner.query(`DROP TYPE "call_status_enum"`);
  }
}
