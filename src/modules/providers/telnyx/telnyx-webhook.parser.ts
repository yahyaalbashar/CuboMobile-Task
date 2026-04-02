import { Injectable, Logger } from '@nestjs/common';
import {
  NormalizedCallEvent,
  NormalizedEventType,
} from '../voice-provider.interface.js';

const EVENT_TYPE_MAP: Record<string, NormalizedEventType> = {
  'call.initiated': NormalizedEventType.CALL_INITIATED,
  'call.answered': NormalizedEventType.CALL_ANSWERED,
  'call.hangup': NormalizedEventType.CALL_HANGUP,
  'call.bridged': NormalizedEventType.CALL_BRIDGED,
  'call_hangup': NormalizedEventType.CALL_HANGUP,
};

// Events that are informational and should be ignored (not mapped to CALL_FAILED)
const IGNORED_EVENTS = new Set([
  'call.cost',
  'call.recording.saved',
  'call.recording.error',
  'call.dtmf.received',
  'call.machine.detection.ended',
  'call.machine.premium.detection.ended',
]);

@Injectable()
export class TelnyxWebhookParser {
  private readonly logger = new Logger(TelnyxWebhookParser.name);

  parse(rawPayload: unknown): NormalizedCallEvent | null {
    const payload = rawPayload as {
      data: {
        id: string;
        event_type: string;
        payload: {
          call_control_id: string;
          call_session_id?: string;
        };
      };
    };

    const data = payload.data;
    const eventType = EVENT_TYPE_MAP[data.event_type];

    if (!eventType) {
      if (IGNORED_EVENTS.has(data.event_type)) {
        this.logger.debug(`Ignoring informational event: ${data.event_type}`);
        return null;
      }

      this.logger.warn(`Unmapped Telnyx event type: ${data.event_type}`);
      return {
        eventType: NormalizedEventType.CALL_FAILED,
        providerCallControlId: data.payload.call_control_id,
        providerSessionId: data.payload.call_session_id,
        rawPayload,
        idempotencyKey: data.id,
      };
    }

    return {
      eventType,
      providerCallControlId: data.payload.call_control_id,
      providerSessionId: data.payload.call_session_id,
      rawPayload,
      idempotencyKey: data.id,
    };
  }
}
