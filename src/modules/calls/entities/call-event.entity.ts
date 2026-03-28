import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Call } from './call.entity.js';

@Entity('call_events')
export class CallEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Call, (call) => call.events)
  @JoinColumn({ name: 'callId' })
  call!: Call;

  @Column()
  callId!: string;

  @Column({ nullable: true, type: 'varchar' })
  legId!: string | null;

  @Column()
  providerEventType!: string;

  @Column({ type: 'jsonb' })
  payload!: unknown;

  @Column({ type: 'timestamp', default: () => 'NOW()' })
  receivedAt!: Date;
}
