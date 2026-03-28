import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

export enum ProcessingStatus {
  PENDING = 'pending',
  PROCESSED = 'processed',
  FAILED = 'failed',
}

@Entity('webhook_deliveries')
export class WebhookDelivery {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  provider!: string;

  @Column({ unique: true })
  externalEventId!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'timestamp', default: () => 'NOW()' })
  receivedAt!: Date;

  @Column({
    type: 'enum',
    enum: ProcessingStatus,
    default: ProcessingStatus.PENDING,
  })
  processingStatus!: ProcessingStatus;

  @Column({ nullable: true, type: 'timestamp' })
  processedAt!: Date | null;

  @Column({ nullable: true, type: 'varchar' })
  errorMessage!: string | null;
}
