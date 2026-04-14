import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
  UsePipes,
  ValidationPipe,
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
  // Override the global ValidationPipe for this endpoint.
  // Telnyx webhook payloads contain arbitrary fields that are not declared in any
  // DTO, so the global `forbidNonWhitelisted: true` setting would reject them with
  // a 400 before the handler could persist them to webhook_deliveries.
  @UsePipes(
    new ValidationPipe({
      transform: false,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  )
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
