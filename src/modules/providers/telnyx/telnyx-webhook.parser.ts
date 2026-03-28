import { Injectable } from '@nestjs/common';
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

@Injectable()
export class TelnyxWebhookParser {
  parse(rawPayload: unknown): NormalizedCallEvent {
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
