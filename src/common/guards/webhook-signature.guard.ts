import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VoiceProvider } from '../../modules/providers/voice-provider.interface.js';
import { VOICE_PROVIDER } from '../../modules/providers/voice-provider.interface.js';

@Injectable()
export class WebhookSignatureGuard implements CanActivate {
  private readonly logger = new Logger(WebhookSignatureGuard.name);

  constructor(
    private readonly configService: ConfigService,
    @Inject(VOICE_PROVIDER)
    private readonly voiceProvider: VoiceProvider,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const webhookSecret = this.configService.get<string>(
      'telnyx.webhookSecret',
      '',
    );

    // If no webhook secret configured, skip verification (dev mode)
    if (!webhookSecret) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const signature = request.headers['telnyx-signature-ed25519'] as string;
    const body = JSON.stringify(request.body);

    if (!signature) {
      this.logger.warn('Missing webhook signature header');
      return false;
    }

    const isValid = this.voiceProvider.verifyWebhookSignature(body, signature);

    if (!isValid) {
      this.logger.warn('Invalid webhook signature');
    }

    return isValid;
  }
}
