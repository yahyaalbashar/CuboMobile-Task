import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  WebhookDelivery,
  ProcessingStatus,
} from './entities/webhook-delivery.entity.js';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookDelivery)
    private readonly webhookRepo: Repository<WebhookDelivery>,
    @InjectQueue('webhooks')
    private readonly webhookQueue: Queue,
  ) {}

  async ingestWebhook(
    provider: string,
    externalEventId: string,
    payload: unknown,
  ): Promise<void> {
    // Persist raw payload first — never lose an event
    const delivery = this.webhookRepo.create({
      provider,
      externalEventId,
      payload,
      processingStatus: ProcessingStatus.PENDING,
    });

    try {
      await this.webhookRepo.save(delivery);
    } catch (error: unknown) {
      // Duplicate externalEventId — already received
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === '23505'
      ) {
        this.logger.debug(
          `Duplicate webhook event: ${externalEventId}, skipping`,
        );
        return;
      }
      throw error;
    }

    // Enqueue for async processing (jobId = externalEventId for dedup at queue level)
    await this.webhookQueue.add(
      'process-webhook',
      { externalEventId, provider, payload },
      { jobId: externalEventId },
    );
  }

  async markProcessed(externalEventId: string): Promise<void> {
    await this.webhookRepo.update(
      { externalEventId },
      {
        processingStatus: ProcessingStatus.PROCESSED,
        processedAt: new Date(),
      },
    );
  }

  async markFailed(
    externalEventId: string,
    errorMessage: string,
  ): Promise<void> {
    await this.webhookRepo.update(
      { externalEventId },
      {
        processingStatus: ProcessingStatus.FAILED,
        errorMessage,
      },
    );
  }

  async isAlreadyProcessed(externalEventId: string): Promise<boolean> {
    const delivery = await this.webhookRepo.findOne({
      where: { externalEventId },
    });
    return delivery?.processingStatus === ProcessingStatus.PROCESSED;
  }
}
