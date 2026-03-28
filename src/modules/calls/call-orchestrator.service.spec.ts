import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CallOrchestratorService } from './call-orchestrator.service.js';
import { CallRepository } from './repositories/call.repository.js';
import { VOICE_PROVIDER, NormalizedEventType } from '../providers/voice-provider.interface.js';
import { CallStatus } from './enums/call-status.enum.js';
import { LegType, LegStatus } from './enums/leg-type.enum.js';

describe('CallOrchestratorService', () => {
  let service: CallOrchestratorService;
  let callRepository: jest.Mocked<CallRepository>;
  let voiceProvider: any;

  const mockCall = {
    id: 'call-uuid-1',
    provider: 'telnyx',
    sourceNumber: '+1111111111',
    destinationNumber: '+2222222222',
    status: CallStatus.INITIATED,
    failureReason: null,
    createdAt: new Date(),
    startedAt: null,
    answeredAt: null,
    endedAt: null,
    durationSeconds: null,
    legs: [],
    events: [],
  };

  const mockWebRTCLeg = {
    id: 'leg-uuid-1',
    callId: 'call-uuid-1',
    legType: LegType.WEBRTC,
    providerCallControlId: 'cc-webrtc-1',
    providerSessionId: 'session-1',
    status: LegStatus.INITIATED,
    createdAt: new Date(),
    call: mockCall as any,
  };

  const mockPSTNLeg = {
    id: 'leg-uuid-2',
    callId: 'call-uuid-1',
    legType: LegType.PSTN,
    providerCallControlId: 'cc-pstn-1',
    providerSessionId: 'session-2',
    status: LegStatus.INITIATED,
    createdAt: new Date(),
    call: mockCall as any,
  };

  beforeEach(async () => {
    voiceProvider = {
      providerName: 'telnyx',
      generateWebRTCToken: jest.fn(),
      dialPSTN: jest.fn().mockResolvedValue({
        providerCallControlId: 'cc-pstn-1',
        providerSessionId: 'session-2',
      }),
      bridge: jest.fn().mockResolvedValue(undefined),
      hangup: jest.fn().mockResolvedValue(undefined),
      parseWebhookEvent: jest.fn(),
      verifyWebhookSignature: jest.fn().mockReturnValue(true),
    };

    const mockCallRepo = {
      createCall: jest.fn().mockResolvedValue(mockCall),
      findCallById: jest.fn().mockResolvedValue(mockCall),
      findCalls: jest.fn().mockResolvedValue([[mockCall], 1]),
      updateCall: jest.fn().mockResolvedValue(undefined),
      createLeg: jest.fn().mockResolvedValue(mockWebRTCLeg),
      findLegByProviderCallControlId: jest.fn(),
      findLegsByCallId: jest.fn().mockResolvedValue([mockWebRTCLeg, mockPSTNLeg]),
      updateLeg: jest.fn().mockResolvedValue(undefined),
      createEvent: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CallOrchestratorService,
        { provide: VOICE_PROVIDER, useValue: voiceProvider },
        { provide: CallRepository, useValue: mockCallRepo },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                'telnyx.sipConnectionId': 'sip-conn-1',
                'telnyx.webhookUrl': 'https://example.com/webhooks/telnyx',
                'telnyx.phoneNumber': '+1111111111',
              };
              return config[key] || '';
            }),
          },
        },
      ],
    }).compile();

    service = module.get(CallOrchestratorService);
    callRepository = module.get(CallRepository);
  });

  describe('handleEvent - CALL_INITIATED', () => {
    it('should create a call and WebRTC leg for incoming WebRTC call', async () => {
      await service.handleEvent({
        eventType: NormalizedEventType.CALL_INITIATED,
        providerCallControlId: 'cc-webrtc-1',
        providerSessionId: 'session-1',
        idempotencyKey: 'event-1',
        rawPayload: {
          data: {
            payload: {
              direction: 'incoming',
              connection_id: 'sip-conn-1',
              from: '+1111111111',
              to: '+2222222222',
            },
          },
        },
      });

      expect(callRepository.createCall).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'telnyx',
          status: CallStatus.INITIATED,
        }),
      );
      expect(callRepository.createLeg).toHaveBeenCalledWith(
        expect.objectContaining({
          legType: LegType.WEBRTC,
          providerCallControlId: 'cc-webrtc-1',
        }),
      );
      expect(callRepository.createEvent).toHaveBeenCalled();
    });
  });

  describe('handleEvent - CALL_ANSWERED (WebRTC leg)', () => {
    it('should transition call to WEBRTC_ANSWERED and dial PSTN', async () => {
      callRepository.findLegByProviderCallControlId.mockResolvedValue(mockWebRTCLeg);

      await service.handleEvent({
        eventType: NormalizedEventType.CALL_ANSWERED,
        providerCallControlId: 'cc-webrtc-1',
        providerSessionId: 'session-1',
        idempotencyKey: 'event-2',
        rawPayload: { data: { payload: {} } },
      });

      expect(callRepository.updateCall).toHaveBeenCalledWith(
        'call-uuid-1',
        expect.objectContaining({ status: CallStatus.WEBRTC_ANSWERED }),
      );
      expect(voiceProvider.dialPSTN).toHaveBeenCalled();
      expect(callRepository.updateCall).toHaveBeenCalledWith(
        'call-uuid-1',
        expect.objectContaining({ status: CallStatus.PSTN_DIALING }),
      );
    });
  });

  describe('handleEvent - CALL_ANSWERED (PSTN leg)', () => {
    it('should transition call to PSTN_ANSWERED and bridge', async () => {
      const pstnAnsweredCall = {
        ...mockCall,
        status: CallStatus.PSTN_DIALING,
      };
      callRepository.findLegByProviderCallControlId.mockResolvedValue(mockPSTNLeg);
      callRepository.findCallById.mockResolvedValue(pstnAnsweredCall as any);

      await service.handleEvent({
        eventType: NormalizedEventType.CALL_ANSWERED,
        providerCallControlId: 'cc-pstn-1',
        providerSessionId: 'session-2',
        idempotencyKey: 'event-3',
        rawPayload: { data: { payload: {} } },
      });

      expect(callRepository.updateCall).toHaveBeenCalledWith(
        'call-uuid-1',
        expect.objectContaining({ status: CallStatus.PSTN_ANSWERED }),
      );
      expect(voiceProvider.bridge).toHaveBeenCalledWith({
        callControlIdA: 'cc-webrtc-1',
        callControlIdB: 'cc-pstn-1',
      });
    });
  });

  describe('handleEvent - CALL_HANGUP', () => {
    it('should end the call and hangup the other leg', async () => {
      const bridgedCall = { ...mockCall, status: CallStatus.BRIDGED, answeredAt: new Date() };
      callRepository.findLegByProviderCallControlId.mockResolvedValue(mockWebRTCLeg);
      callRepository.findCallById.mockResolvedValue(bridgedCall as any);

      await service.handleEvent({
        eventType: NormalizedEventType.CALL_HANGUP,
        providerCallControlId: 'cc-webrtc-1',
        providerSessionId: 'session-1',
        idempotencyKey: 'event-4',
        rawPayload: { data: { payload: {} } },
      });

      expect(voiceProvider.hangup).toHaveBeenCalledWith('cc-pstn-1');
      expect(callRepository.updateCall).toHaveBeenCalledWith(
        'call-uuid-1',
        expect.objectContaining({ status: CallStatus.ENDED }),
      );
    });

    it('should no-op if call is already ended', async () => {
      const endedCall = { ...mockCall, status: CallStatus.ENDED };
      callRepository.findLegByProviderCallControlId.mockResolvedValue(mockWebRTCLeg);
      callRepository.findCallById.mockResolvedValue(endedCall as any);

      await service.handleEvent({
        eventType: NormalizedEventType.CALL_HANGUP,
        providerCallControlId: 'cc-webrtc-1',
        providerSessionId: 'session-1',
        idempotencyKey: 'event-5',
        rawPayload: { data: { payload: {} } },
      });

      expect(voiceProvider.hangup).not.toHaveBeenCalled();
    });
  });

  describe('State machine transitions', () => {
    it('should not allow backward transitions', async () => {
      const bridgedCall = { ...mockCall, status: CallStatus.BRIDGED };
      callRepository.findLegByProviderCallControlId.mockResolvedValue(mockWebRTCLeg);
      callRepository.findCallById.mockResolvedValue(bridgedCall as any);

      // Attempt to go back to INITIATED-like state by sending an initiated event
      // The handleCallInitiated won't find it as WebRTC (different connection_id scenario)
      // but the state machine itself prevents backward transitions
      await service.handleEvent({
        eventType: NormalizedEventType.CALL_ANSWERED,
        providerCallControlId: 'cc-webrtc-1',
        providerSessionId: 'session-1',
        idempotencyKey: 'event-6',
        rawPayload: { data: { payload: {} } },
      });

      // BRIDGED -> WEBRTC_ANSWERED is invalid, so the call should not have been updated
      // to WEBRTC_ANSWERED — but the bridge call should also not be issued since it's
      // already bridged
      expect(callRepository.updateCall).not.toHaveBeenCalledWith(
        'call-uuid-1',
        expect.objectContaining({ status: CallStatus.WEBRTC_ANSWERED }),
      );
    });
  });
});
