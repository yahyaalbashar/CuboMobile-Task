import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service.js';
import { WebhookSignatureGuard } from '../../common/guards/webhook-signature.guard.js';

@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('telnyx')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WebhookSignatureGuard)
  @ApiOperation({ summary: 'Telnyx webhook event ingestion' })
  @ApiResponse({ status: 200, description: 'Event received and enqueued' })
  async handleTelnyxWebhook(
    @Body() body: Record<string, unknown>,
    @Req() _req: Request,
  ): Promise<{ received: boolean }> {
    const data = body.data as
      | { id?: string; event_type?: string }
      | undefined;
    const externalEventId = data?.id;

    if (!externalEventId) {
      return { received: false };
    }

    await this.webhooksService.ingestWebhook(
      'telnyx',
      externalEventId as string,
      body,
    );

    return { received: true };
  }
}
