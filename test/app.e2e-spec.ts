import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { VOICE_PROVIDER } from './../src/modules/providers/voice-provider.interface';
import { CallRepository } from './../src/modules/calls/repositories/call.repository';
import { CallStatus } from './../src/modules/calls/enums/call-status.enum';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Call } from './../src/modules/calls/entities/call.entity';
import { CallLeg } from './../src/modules/calls/entities/call-leg.entity';
import { CallEvent } from './../src/modules/calls/entities/call-event.entity';
import { WebhookDelivery } from './../src/modules/webhooks/entities/webhook-delivery.entity';

/**
 * E2E tests for the API endpoints.
 *
 * These tests override external dependencies (VoiceProvider, database repositories)
 * with in-memory mocks so they can run without PostgreSQL, Redis, or Telnyx credentials.
 */
describe('API Endpoints (e2e)', () => {
  let app: INestApplication<App>;

  const mockCall = {
    id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    provider: 'telnyx',
    sourceNumber: '+15551234567',
    destinationNumber: '+15559876543',
    status: CallStatus.BRIDGED,
    failureReason: null,
    createdAt: new Date('2026-04-01T12:00:00Z'),
    startedAt: null,
    answeredAt: new Date('2026-04-01T12:00:05Z'),
    endedAt: null,
    durationSeconds: null,
    legs: [],
    events: [],
  };

  const mockVoiceProvider = {
    providerName: 'telnyx',
    generateWebRTCToken: jest.fn().mockResolvedValue('mock-jwt-token'),
    dialPSTN: jest.fn().mockResolvedValue({
      providerCallControlId: 'cc-pstn-1',
      providerSessionId: 'session-1',
    }),
    bridge: jest.fn().mockResolvedValue(undefined),
    hangup: jest.fn().mockResolvedValue(undefined),
    parseWebhookEvent: jest.fn(),
    verifyWebhookSignature: jest.fn().mockReturnValue(true),
  };

  const mockCallRepository = {
    createCall: jest.fn().mockResolvedValue(mockCall),
    findCallById: jest.fn().mockResolvedValue(mockCall),
    findCalls: jest.fn().mockResolvedValue([[mockCall], 1]),
    updateCall: jest.fn().mockResolvedValue(undefined),
    createLeg: jest.fn().mockResolvedValue({}),
    findLegByProviderCallControlId: jest.fn().mockResolvedValue(null),
    findLegsByCallId: jest.fn().mockResolvedValue([]),
    updateLeg: jest.fn().mockResolvedValue(undefined),
    createEvent: jest.fn().mockResolvedValue({}),
  };

  const mockRepository = {
    create: jest.fn().mockImplementation((data) => data),
    save: jest.fn().mockImplementation((data) => Promise.resolve({ id: 'mock-id', ...data })),
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn().mockReturnValue({
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    }),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(VOICE_PROVIDER)
      .useValue(mockVoiceProvider)
      .overrideProvider(CallRepository)
      .useValue(mockCallRepository)
      .overrideProvider(getRepositoryToken(Call))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(CallLeg))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(CallEvent))
      .useValue(mockRepository)
      .overrideProvider(getRepositoryToken(WebhookDelivery))
      .useValue(mockRepository)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/webrtc-token', () => {
    it('should return a token for a valid identity', () => {
      return request(app.getHttpServer())
        .post('/auth/webrtc-token')
        .send({ identity: 'test-user' })
        .expect(201)
        .expect((res) => {
          expect(res.body.token).toBe('mock-jwt-token');
          expect(res.body.identity).toBe('test-user');
        });
    });

    it('should reject requests without identity', () => {
      return request(app.getHttpServer())
        .post('/auth/webrtc-token')
        .send({})
        .expect(400);
    });
  });

  describe('GET /calls', () => {
    it('should return paginated call history', () => {
      return request(app.getHttpServer())
        .get('/calls')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('data');
          expect(res.body).toHaveProperty('total');
          expect(res.body).toHaveProperty('page');
          expect(res.body).toHaveProperty('limit');
        });
    });

    it('should accept pagination parameters', () => {
      return request(app.getHttpServer())
        .get('/calls?page=1&limit=10')
        .expect(200);
    });
  });

  describe('GET /calls/:id', () => {
    it('should return call details for a valid UUID', () => {
      return request(app.getHttpServer())
        .get(`/calls/${mockCall.id}`)
        .expect(200);
    });

    it('should return 400 for invalid UUID', () => {
      return request(app.getHttpServer())
        .get('/calls/not-a-uuid')
        .expect(400);
    });
  });

  describe('POST /calls/:id/hangup', () => {
    it('should terminate an active call', () => {
      return request(app.getHttpServer())
        .post(`/calls/${mockCall.id}/hangup`)
        .expect(200)
        .expect((res) => {
          expect(res.body.message).toBe('Call hangup initiated');
        });
    });

    it('should return 400 for invalid UUID', () => {
      return request(app.getHttpServer())
        .post('/calls/not-a-uuid/hangup')
        .expect(400);
    });
  });

  describe('POST /webhooks/telnyx', () => {
    it('should accept a valid webhook payload', () => {
      return request(app.getHttpServer())
        .post('/webhooks/telnyx')
        .send({
          data: {
            id: 'evt-unique-123',
            event_type: 'call.initiated',
            payload: {
              call_control_id: 'cc-1',
              direction: 'incoming',
              connection_id: 'sip-conn-1',
            },
          },
        })
        .expect(200)
        .expect((res) => {
          expect(res.body.received).toBe(true);
        });
    });

    it('should reject payload without event id', () => {
      return request(app.getHttpServer())
        .post('/webhooks/telnyx')
        .send({ data: {} })
        .expect(200)
        .expect((res) => {
          expect(res.body.received).toBe(false);
        });
    });
  });
});
