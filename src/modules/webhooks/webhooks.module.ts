import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { WebhookProcessor } from './webhook-processor.js';
import { WebhookDelivery } from './entities/webhook-delivery.entity.js';
import { CallsModule } from '../calls/calls.module.js';
import { ProvidersModule } from '../providers/providers.module.js';

@Module({
  imports: [
    TypeOrmModule.forFeature([WebhookDelivery]),
    BullModule.registerQueue({ name: 'webhooks' }),
    CallsModule,
    ProvidersModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookProcessor],
})
export class WebhooksModule {}
