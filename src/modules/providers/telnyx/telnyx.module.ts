import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TelnyxProvider } from './telnyx.provider.js';
import { TelnyxWebhookParser } from './telnyx-webhook.parser.js';

@Module({
  imports: [HttpModule],
  providers: [TelnyxProvider, TelnyxWebhookParser],
  exports: [TelnyxProvider],
})
export class TelnyxModule {}
