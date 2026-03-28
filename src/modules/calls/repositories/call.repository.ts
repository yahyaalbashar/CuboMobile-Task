import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Call } from '../entities/call.entity.js';
import { CallLeg } from '../entities/call-leg.entity.js';
import { CallEvent } from '../entities/call-event.entity.js';
import { GetCallsDto } from '../dto/get-calls.dto.js';

@Injectable()
export class CallRepository {
  constructor(
    @InjectRepository(Call)
    private readonly callRepo: Repository<Call>,
    @InjectRepository(CallLeg)
    private readonly legRepo: Repository<CallLeg>,
    @InjectRepository(CallEvent)
    private readonly eventRepo: Repository<CallEvent>,
  ) {}

  async createCall(data: Partial<Call>): Promise<Call> {
    const call = this.callRepo.create(data);
    return this.callRepo.save(call);
  }

  async findCallById(id: string): Promise<Call | null> {
    return this.callRepo.findOne({
      where: { id },
      relations: ['legs', 'events'],
    });
  }

  async findCalls(dto: GetCallsDto): Promise<[Call[], number]> {
    const qb = this.callRepo.createQueryBuilder('call');

    if (dto.status) {
      qb.andWhere('call.status = :status', { status: dto.status });
    }
    if (dto.from) {
      qb.andWhere('call.createdAt >= :from', { from: dto.from });
    }
    if (dto.to) {
      qb.andWhere('call.createdAt <= :to', { to: dto.to });
    }

    qb.orderBy('call.createdAt', 'DESC');
    qb.skip(((dto.page ?? 1) - 1) * (dto.limit ?? 20));
    qb.take(dto.limit ?? 20);

    return qb.getManyAndCount();
  }

  async updateCall(id: string, data: Partial<Call>): Promise<void> {
    await this.callRepo.update(id, data as any);
  }

  async createLeg(data: Partial<CallLeg>): Promise<CallLeg> {
    const leg = this.legRepo.create(data);
    return this.legRepo.save(leg);
  }

  async findLegByProviderCallControlId(
    providerCallControlId: string,
  ): Promise<CallLeg | null> {
    return this.legRepo.findOne({ where: { providerCallControlId } });
  }

  async findLegsByCallId(callId: string): Promise<CallLeg[]> {
    return this.legRepo.find({ where: { callId } });
  }

  async updateLeg(id: string, data: Partial<CallLeg>): Promise<void> {
    await this.legRepo.update(id, data as any);
  }

  async createEvent(data: Partial<CallEvent>): Promise<CallEvent> {
    const event = this.eventRepo.create(data);
    return this.eventRepo.save(event);
  }
}
