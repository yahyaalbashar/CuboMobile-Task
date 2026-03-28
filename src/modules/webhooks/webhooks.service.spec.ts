import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { getQueueToken } from '@nestjs/bullmq';
import { WebhooksService } from './webhooks.service.js';
import { WebhookDelivery, ProcessingStatus } from './entities/webhook-delivery.entity.js';

describe('WebhooksService', () => {
  let service: WebhooksService;
  let webhookRepo: any;
  let webhookQueue: any;

  beforeEach(async () => {
    webhookRepo = {
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) => Promise.resolve({ id: 'wh-1', ...data })),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    webhookQueue = {
      add: jest.fn().mockResolvedValue({}),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhooksService,
        { provide: getRepositoryToken(WebhookDelivery), useValue: webhookRepo },
        { provide: getQueueToken('webhooks'), useValue: webhookQueue },
      ],
    }).compile();

    service = module.get(WebhooksService);
  });

  describe('ingestWebhook', () => {
    it('should persist the webhook and enqueue a job', async () => {
      const payload = { data: { id: 'evt-1', event_type: 'call.initiated' } };

      await service.ingestWebhook('telnyx', 'evt-1', payload);

      expect(webhookRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'telnyx',
          externalEventId: 'evt-1',
          processingStatus: ProcessingStatus.PENDING,
        }),
      );
      expect(webhookQueue.add).toHaveBeenCalledWith(
        'process-webhook',
        expect.objectContaining({ externalEventId: 'evt-1' }),
        { jobId: 'evt-1' },
      );
    });

    it('should skip duplicate events (unique constraint violation)', async () => {
      const error: any = new Error('duplicate');
      error.code = '23505';
      webhookRepo.save.mockRejectedValue(error);

      await service.ingestWebhook('telnyx', 'evt-dup', {});

      expect(webhookQueue.add).not.toHaveBeenCalled();
    });

    it('should re-throw non-duplicate errors', async () => {
      webhookRepo.save.mockRejectedValue(new Error('DB down'));

      await expect(
        service.ingestWebhook('telnyx', 'evt-err', {}),
      ).rejects.toThrow('DB down');
    });
  });

  describe('isAlreadyProcessed', () => {
    it('should return true if status is PROCESSED', async () => {
      webhookRepo.findOne.mockResolvedValue({
        processingStatus: ProcessingStatus.PROCESSED,
      });

      expect(await service.isAlreadyProcessed('evt-1')).toBe(true);
    });

    it('should return false if status is PENDING', async () => {
      webhookRepo.findOne.mockResolvedValue({
        processingStatus: ProcessingStatus.PENDING,
      });

      expect(await service.isAlreadyProcessed('evt-1')).toBe(false);
    });

    it('should return false if not found', async () => {
      webhookRepo.findOne.mockResolvedValue(null);

      expect(await service.isAlreadyProcessed('evt-unknown')).toBe(false);
    });
  });

  describe('markProcessed', () => {
    it('should update status to PROCESSED', async () => {
      await service.markProcessed('evt-1');

      expect(webhookRepo.update).toHaveBeenCalledWith(
        { externalEventId: 'evt-1' },
        expect.objectContaining({
          processingStatus: ProcessingStatus.PROCESSED,
        }),
      );
    });
  });

  describe('markFailed', () => {
    it('should update status to FAILED with error message', async () => {
      await service.markFailed('evt-1', 'Something broke');

      expect(webhookRepo.update).toHaveBeenCalledWith(
        { externalEventId: 'evt-1' },
        expect.objectContaining({
          processingStatus: ProcessingStatus.FAILED,
          errorMessage: 'Something broke',
        }),
      );
    });
  });
});
