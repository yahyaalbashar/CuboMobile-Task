import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CallRepository } from './repositories/call.repository.js';
import { CallStatus, isValidTransition } from './enums/call-status.enum.js';
import { LegType, LegStatus } from './enums/leg-type.enum.js';
import type { VoiceProvider, NormalizedCallEvent } from '../providers/voice-provider.interface.js';
import { NormalizedEventType, VOICE_PROVIDER } from '../providers/voice-provider.interface.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { Call } from './entities/call.entity.js';

@Injectable()
export class CallOrchestratorService {
  private readonly logger = new Logger(CallOrchestratorService.name);

  constructor(
    @Inject(VOICE_PROVIDER)
    private readonly voiceProvider: VoiceProvider,
    private readonly callRepository: CallRepository,
    private readonly configService: ConfigService,
    @Optional()
    private readonly realtimeGateway?: RealtimeGateway,
  ) {}

  async handleEvent(event: NormalizedCallEvent): Promise<void> {
    switch (event.eventType) {
      case NormalizedEventType.CALL_INITIATED:
        await this.handleCallInitiated(event);
        break;
      case NormalizedEventType.CALL_ANSWERED:
        await this.handleCallAnswered(event);
        break;
      case NormalizedEventType.CALL_HANGUP:
        await this.handleCallHangup(event);
        break;
      case NormalizedEventType.CALL_BRIDGED:
        await this.handleCallBridged(event);
        break;
      case NormalizedEventType.CALL_FAILED:
        await this.handleCallFailed(event);
        break;
    }
  }

  private async handleCallInitiated(event: NormalizedCallEvent): Promise<void> {
    const rawPayload = event.rawPayload as {
      data: {
        payload: {
          direction: string;
          connection_id: string;
          from: string;
          to: string;
          client_state?: string;
        };
      };
    };

    const payload = rawPayload.data.payload;
    const sipConnectionId = this.configService.get<string>(
      'telnyx.sipConnectionId',
      '',
    );

    // Check if this is the WebRTC leg (incoming to our SIP connection)
    const isWebRTCLeg =
      payload.direction === 'incoming' &&
      payload.connection_id === sipConnectionId;

    if (isWebRTCLeg) {
      // Step 1: Create call + WebRTC leg
      const call = await this.callRepository.createCall({
        provider: this.voiceProvider.providerName,
        sourceNumber: payload.from || '',
        destinationNumber: payload.to || '',
        status: CallStatus.INITIATED,
      });

      await this.callRepository.createLeg({
        callId: call.id,
        legType: LegType.WEBRTC,
        providerCallControlId: event.providerCallControlId,
        providerSessionId: event.providerSessionId || null,
        status: LegStatus.INITIATED,
      });

      await this.callRepository.createEvent({
        callId: call.id,
        providerEventType: event.eventType,
        payload: event.rawPayload,
      });

      this.logger.log(`Call ${call.id} initiated with WebRTC leg`);
    } else if (payload.client_state) {
      // This is the PSTN leg initiated event — we already created the leg in handleCallAnswered
      const clientState = this.decodeClientState(payload.client_state);
      if (clientState?.callId) {
        await this.callRepository.createEvent({
          callId: clientState.callId,
          providerEventType: event.eventType,
          payload: event.rawPayload,
        });
      }
    }
  }

  private async handleCallAnswered(event: NormalizedCallEvent): Promise<void> {
    const leg = await this.callRepository.findLegByProviderCallControlId(
      event.providerCallControlId,
    );

    if (leg) {
      // Known leg (WebRTC leg answered)
      const call = await this.callRepository.findCallById(leg.callId);
      if (!call) return;

      await this.callRepository.createEvent({
        callId: call.id,
        legId: leg.id,
        providerEventType: event.eventType,
        payload: event.rawPayload,
      });

      if (leg.legType === LegType.WEBRTC) {
        // Step 2: WebRTC answered → dial PSTN
        await this.transitionCall(call, CallStatus.WEBRTC_ANSWERED);
        await this.callRepository.updateCall(call.id, {
          answeredAt: new Date(),
        });
        await this.callRepository.updateLeg(leg.id, {
          status: LegStatus.ANSWERED,
        });

        await this.dialPSTNLeg(call);
      } else if (leg.legType === LegType.PSTN) {
        // Step 3: PSTN answered → bridge
        await this.transitionCall(call, CallStatus.PSTN_ANSWERED);
        await this.callRepository.updateLeg(leg.id, {
          status: LegStatus.ANSWERED,
        });

        await this.bridgeCall(call);
      }
    } else {
      // Unknown leg — correlate via client_state (PSTN leg answer arrived
      // before the leg record was committed, or a race condition occurred)
      const rawPayload = event.rawPayload as {
        data: { payload: { client_state?: string } };
      };
      const clientState = rawPayload.data.payload.client_state
        ? this.decodeClientState(rawPayload.data.payload.client_state)
        : null;

      if (clientState?.callId) {
        const call = await this.callRepository.findCallById(
          clientState.callId,
        );
        if (!call) return;

        // Find the PSTN leg among the call's existing legs
        const legs = await this.callRepository.findLegsByCallId(call.id);
        let pstnLeg = legs.find((l) => l.legType === LegType.PSTN);

        if (!pstnLeg) {
          // PSTN leg record not yet persisted — create it now
          pstnLeg = await this.callRepository.createLeg({
            callId: call.id,
            legType: LegType.PSTN,
            providerCallControlId: event.providerCallControlId,
            providerSessionId: event.providerSessionId || null,
            status: LegStatus.INITIATED,
          });
          this.logger.warn(
            `Created missing PSTN leg for call ${call.id} from client_state correlation`,
          );
        }

        await this.callRepository.createEvent({
          callId: call.id,
          legId: pstnLeg.id,
          providerEventType: event.eventType,
          payload: event.rawPayload,
        });

        await this.transitionCall(call, CallStatus.PSTN_ANSWERED);
        await this.callRepository.updateLeg(pstnLeg.id, {
          status: LegStatus.ANSWERED,
        });

        await this.bridgeCall(call);
      }
    }
  }

  private async handleCallHangup(event: NormalizedCallEvent): Promise<void> {
    const leg = await this.callRepository.findLegByProviderCallControlId(
      event.providerCallControlId,
    );

    if (!leg) {
      this.logger.warn(
        `Hangup received for unknown leg: ${event.providerCallControlId}`,
      );
      return;
    }

    const call = await this.callRepository.findCallById(leg.callId);
    if (!call) return;

    await this.callRepository.createEvent({
      callId: call.id,
      legId: leg.id,
      providerEventType: event.eventType,
      payload: event.rawPayload,
    });

    if (call.status === CallStatus.ENDED) {
      return; // Already ended, no-op
    }

    await this.callRepository.updateLeg(leg.id, { status: LegStatus.ENDED });

    // Hang up the other leg
    const legs = await this.callRepository.findLegsByCallId(call.id);
    for (const otherLeg of legs) {
      if (
        otherLeg.id !== leg.id &&
        otherLeg.status !== LegStatus.ENDED &&
        otherLeg.status !== LegStatus.FAILED
      ) {
        try {
          await this.voiceProvider.hangup(otherLeg.providerCallControlId);
        } catch (error) {
          this.logger.warn(
            `Failed to hang up other leg ${otherLeg.id}: ${error}`,
          );
        }
        await this.callRepository.updateLeg(otherLeg.id, {
          status: LegStatus.ENDED,
        });
      }
    }

    const endedAt = new Date();
    const durationSeconds = call.answeredAt
      ? Math.round((endedAt.getTime() - call.answeredAt.getTime()) / 1000)
      : null;

    await this.transitionCall(call, CallStatus.ENDED);
    await this.callRepository.updateCall(call.id, {
      endedAt,
      durationSeconds,
    });
  }

  private async handleCallBridged(event: NormalizedCallEvent): Promise<void> {
    const leg = await this.callRepository.findLegByProviderCallControlId(
      event.providerCallControlId,
    );

    if (!leg) return;

    const call = await this.callRepository.findCallById(leg.callId);
    if (!call) return;

    await this.callRepository.createEvent({
      callId: call.id,
      legId: leg.id,
      providerEventType: event.eventType,
      payload: event.rawPayload,
    });

    // If we transitioned to BRIDGED via our own bridge command, we might already be BRIDGED
    if (call.status !== CallStatus.BRIDGED) {
      await this.transitionCall(call, CallStatus.BRIDGED);
    }
  }

  private async handleCallFailed(event: NormalizedCallEvent): Promise<void> {
    const leg = await this.callRepository.findLegByProviderCallControlId(
      event.providerCallControlId,
    );

    if (!leg) return;

    const call = await this.callRepository.findCallById(leg.callId);
    if (!call) return;

    await this.callRepository.createEvent({
      callId: call.id,
      legId: leg.id,
      providerEventType: event.eventType,
      payload: event.rawPayload,
    });

    await this.callRepository.updateLeg(leg.id, { status: LegStatus.FAILED });
    await this.transitionCall(call, CallStatus.FAILED);
    await this.callRepository.updateCall(call.id, {
      failureReason: 'Call failed',
      endedAt: new Date(),
    });
  }

  private async dialPSTNLeg(call: Call): Promise<void> {
    try {
      const webhookUrl = this.configService.get<string>(
        'telnyx.webhookUrl',
        '',
      );
      const fromNumber = this.configService.get<string>(
        'telnyx.phoneNumber',
        '',
      );

      const clientState = JSON.stringify({ callId: call.id });

      const pstnLeg = await this.voiceProvider.dialPSTN({
        from: fromNumber,
        to: call.destinationNumber,
        webhookUrl,
        clientState,
      });

      await this.transitionCall(call, CallStatus.PSTN_DIALING);
      await this.callRepository.createLeg({
        callId: call.id,
        legType: LegType.PSTN,
        providerCallControlId: pstnLeg.providerCallControlId,
        providerSessionId: pstnLeg.providerSessionId || null,
        status: LegStatus.INITIATED,
      });

      this.logger.log(`PSTN leg dialed for call ${call.id}`);
    } catch (error) {
      this.logger.error(`Failed to dial PSTN for call ${call.id}`, error);
      await this.transitionCall(call, CallStatus.FAILED);
      await this.callRepository.updateCall(call.id, {
        failureReason: 'Failed to dial PSTN leg',
        endedAt: new Date(),
      });
    }
  }

  private async bridgeCall(call: Call): Promise<void> {
    const legs = await this.callRepository.findLegsByCallId(call.id);
    const webrtcLeg = legs.find((l) => l.legType === LegType.WEBRTC);
    const pstnLeg = legs.find((l) => l.legType === LegType.PSTN);

    if (!webrtcLeg || !pstnLeg) {
      this.logger.error(`Cannot bridge call ${call.id}: missing legs`);
      return;
    }

    try {
      await this.voiceProvider.bridge({
        callControlIdA: webrtcLeg.providerCallControlId,
        callControlIdB: pstnLeg.providerCallControlId,
      });

      await this.transitionCall(call, CallStatus.BRIDGED);
      this.logger.log(`Call ${call.id} bridged successfully`);
    } catch (error) {
      this.logger.error(`Failed to bridge call ${call.id}`, error);
      await this.transitionCall(call, CallStatus.FAILED);
      await this.callRepository.updateCall(call.id, {
        failureReason: 'Failed to bridge calls',
        endedAt: new Date(),
      });
    }
  }

  private async transitionCall(
    call: Call,
    newStatus: CallStatus,
  ): Promise<void> {
    if (!isValidTransition(call.status, newStatus)) {
      this.logger.warn(
        `Invalid state transition for call ${call.id}: ${call.status} → ${newStatus}`,
      );
      return;
    }
    await this.callRepository.updateCall(call.id, { status: newStatus });
    call.status = newStatus;

    // Push real-time state update to connected clients
    this.realtimeGateway?.emitCallStateUpdate(call.id, newStatus);
  }

  private decodeClientState(
    clientState: string,
  ): { callId: string } | null {
    try {
      const decoded = Buffer.from(clientState, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch {
      return null;
    }
  }
}
