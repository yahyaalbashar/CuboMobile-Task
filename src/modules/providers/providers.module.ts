import { Module } from '@nestjs/common';
import { TelnyxModule } from './telnyx/telnyx.module.js';
import { TelnyxProvider } from './telnyx/telnyx.provider.js';
import { VOICE_PROVIDER } from './voice-provider.interface.js';

@Module({
  imports: [TelnyxModule],
  providers: [
    {
      provide: VOICE_PROVIDER,
      useExisting: TelnyxProvider,
    },
  ],
  exports: [VOICE_PROVIDER],
})
export class ProvidersModule {}
