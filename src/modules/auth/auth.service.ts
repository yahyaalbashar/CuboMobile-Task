import { Injectable, Inject } from '@nestjs/common';
import type { VoiceProvider } from '../providers/voice-provider.interface.js';
import { VOICE_PROVIDER } from '../providers/voice-provider.interface.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(VOICE_PROVIDER)
    private readonly voiceProvider: VoiceProvider,
  ) {}

  async generateWebRTCToken(
    identity: string,
  ): Promise<{ token: string; identity: string }> {
    const token = await this.voiceProvider.generateWebRTCToken(identity);
    return { token, identity };
  }
}
