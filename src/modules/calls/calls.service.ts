import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { CallRepository } from './repositories/call.repository.js';
import type { VoiceProvider } from '../providers/voice-provider.interface.js';
import { VOICE_PROVIDER } from '../providers/voice-provider.interface.js';
import { GetCallsDto } from './dto/get-calls.dto.js';
import { Call } from './entities/call.entity.js';
import { CallStatus } from './enums/call-status.enum.js';
import { LegStatus } from './enums/leg-type.enum.js';

@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private readonly callRepository: CallRepository,
    @Inject(VOICE_PROVIDER)
    private readonly voiceProvider: VoiceProvider,
  ) {}

  async getCalls(
    dto: GetCallsDto,
  ): Promise<{ data: Call[]; total: number; page: number; limit: number }> {
    const [data, total] = await this.callRepository.findCalls(dto);
    return { data, total, page: dto.page ?? 1, limit: dto.limit ?? 20 };
  }

  async getCallById(id: string): Promise<Call> {
    const call = await this.callRepository.findCallById(id);
    if (!call) {
      throw new NotFoundException(`Call ${id} not found`);
    }
    return call;
  }

  async hangupCall(id: string): Promise<void> {
    const call = await this.callRepository.findCallById(id);
    if (!call) {
      throw new NotFoundException(`Call ${id} not found`);
    }

    if (call.status === CallStatus.ENDED || call.status === CallStatus.FAILED) {
      return; // Idempotent: already ended
    }

    const legs = await this.callRepository.findLegsByCallId(id);
    for (const leg of legs) {
      if (
        leg.status !== LegStatus.ENDED &&
        leg.status !== LegStatus.FAILED
      ) {
        try {
          await this.voiceProvider.hangup(leg.providerCallControlId);
        } catch (error) {
          this.logger.warn(`Failed to hangup leg ${leg.id}: ${error}`);
        }
        await this.callRepository.updateLeg(leg.id, {
          status: LegStatus.ENDED,
        });
      }
    }

    const endedAt = new Date();
    const durationSeconds = call.answeredAt
      ? Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000)
      : null;

    await this.callRepository.updateCall(id, {
      status: CallStatus.ENDED,
      endedAt,
      durationSeconds,
    });
  }
}
