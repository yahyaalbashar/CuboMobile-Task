import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { LegType, LegStatus } from '../enums/leg-type.enum.js';
import { Call } from './call.entity.js';

@Entity('call_legs')
export class CallLeg {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => Call, (call) => call.legs)
  @JoinColumn({ name: 'callId' })
  call!: Call;

  @Column()
  callId!: string;

  @Column({ type: 'enum', enum: LegType })
  legType!: LegType;

  @Column({ unique: true })
  providerCallControlId!: string;

  @Column({ nullable: true, type: 'varchar' })
  providerSessionId!: string | null;

  @Column({ type: 'enum', enum: LegStatus, default: LegStatus.INITIATED })
  status!: LegStatus;

  @CreateDateColumn()
  createdAt!: Date;
}
