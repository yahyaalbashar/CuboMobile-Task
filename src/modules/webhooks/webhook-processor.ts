import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { WebhooksService } from './webhooks.service.js';
import { CallOrchestratorService } from '../calls/call-orchestrator.service.js';
import type { VoiceProvider } from '../providers/voice-provider.interface.js';
import { VOICE_PROVIDER } from '../providers/voice-provider.interface.js';

interface WebhookJobData {
  externalEventId: string;
  provider: string;
  payload: unknown;
}

@Processor('webhooks')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly orchestrator: CallOrchestratorService,
    @Inject(VOICE_PROVIDER)
    private readonly voiceProvider: VoiceProvider,
  ) {
    super();
  }

  async process(job: Job<WebhookJobData>): Promise<void> {
    const { externalEventId, payload } = job.data;

    try {
      // Check if already processed (idempotency)
      if (await this.webhooksService.isAlreadyProcessed(externalEventId)) {
        this.logger.debug(`Event ${externalEventId} already processed, skipping`);
        return;
      }

      // Parse the raw payload into a normalized event
      const event = this.voiceProvider.parseWebhookEvent(payload);

      // Route to the call orchestrator
      await this.orchestrator.handleEvent(event);

      // Mark as processed
      await this.webhooksService.markProcessed(externalEventId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process webhook ${externalEventId}: ${message}`,
      );
      await this.webhooksService.markFailed(externalEventId, message);
      // Do NOT re-throw to avoid infinite retry
    }
  }
}
