import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  OneToMany,
} from 'typeorm';
import { CallStatus } from '../enums/call-status.enum.js';
import { CallLeg } from './call-leg.entity.js';
import { CallEvent } from './call-event.entity.js';

@Entity('calls')
export class Call {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  provider!: string;

  @Column()
  sourceNumber!: string;

  @Column()
  destinationNumber!: string;

  @Column({ type: 'enum', enum: CallStatus, default: CallStatus.INITIATED })
  status!: CallStatus;

  @Column({ nullable: true, type: 'varchar' })
  failureReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @Column({ nullable: true, type: 'timestamp' })
  startedAt!: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  answeredAt!: Date | null;

  @Column({ nullable: true, type: 'timestamp' })
  endedAt!: Date | null;

  @Column({ nullable: true, type: 'int' })
  durationSeconds!: number | null;

  @OneToMany(() => CallLeg, (leg) => leg.call, { cascade: true })
  legs!: CallLeg[];

  @OneToMany(() => CallEvent, (event) => event.call, { cascade: true })
  events!: CallEvent[];
}
