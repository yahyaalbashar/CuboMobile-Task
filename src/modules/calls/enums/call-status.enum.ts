export enum CallStatus {
  INITIATED = 'initiated',
  WEBRTC_ANSWERED = 'webrtc_answered',
  PSTN_DIALING = 'pstn_dialing',
  PSTN_ANSWERED = 'pstn_answered',
  BRIDGED = 'bridged',
  ENDED = 'ended',
  FAILED = 'failed',
}

export const VALID_TRANSITIONS: Record<CallStatus, CallStatus[]> = {
  [CallStatus.INITIATED]: [CallStatus.WEBRTC_ANSWERED, CallStatus.BRIDGED, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.WEBRTC_ANSWERED]: [CallStatus.PSTN_DIALING, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.PSTN_DIALING]: [CallStatus.PSTN_ANSWERED, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.PSTN_ANSWERED]: [CallStatus.BRIDGED, CallStatus.ENDED, CallStatus.FAILED],
  [CallStatus.BRIDGED]: [CallStatus.ENDED],
  [CallStatus.ENDED]: [],
  [CallStatus.FAILED]: [],
};

export function isValidTransition(from: CallStatus, to: CallStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}
