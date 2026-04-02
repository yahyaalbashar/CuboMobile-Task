import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VoiceProvider } from '../providers/voice-provider.interface.js';
import { VOICE_PROVIDER } from '../providers/voice-provider.interface.js';

@Injectable()
export class AuthService {
  constructor(
    @Inject(VOICE_PROVIDER)
    private readonly voiceProvider: VoiceProvider,
    private readonly configService: ConfigService,
  ) {}

  async generateWebRTCToken(
    identity: string,
  ): Promise<{ token: string; identity: string; callerNumber: string }> {
    const token = await this.voiceProvider.generateWebRTCToken(identity);
    const callerNumber = this.configService.get<string>('telnyx.phoneNumber', '');
    return { token, identity, callerNumber };
  }
}
