export interface ProviderLeg {
  providerCallControlId: string;
  providerSessionId?: string;
}

export enum NormalizedEventType {
  CALL_INITIATED = 'call.initiated',
  CALL_ANSWERED = 'call.answered',
  CALL_HANGUP = 'call.hangup',
  CALL_BRIDGED = 'call.bridged',
  CALL_FAILED = 'call.failed',
}

export interface NormalizedCallEvent {
  eventType: NormalizedEventType;
  providerCallControlId: string;
  providerSessionId?: string;
  rawPayload: unknown;
  idempotencyKey: string;
}

export interface VoiceProvider {
  readonly providerName: string;

  generateWebRTCToken(identity: string): Promise<string>;

  dialPSTN(params: {
    from: string;
    to: string;
    webhookUrl: string;
    clientState?: string;
  }): Promise<ProviderLeg>;

  bridge(params: {
    callControlIdA: string;
    callControlIdB: string;
  }): Promise<void>;

  hangup(callControlId: string): Promise<void>;

  parseWebhookEvent(rawPayload: unknown): NormalizedCallEvent;

  verifyWebhookSignature(payload: string, signature: string): boolean;
}

export const VOICE_PROVIDER = 'VOICE_PROVIDER';
