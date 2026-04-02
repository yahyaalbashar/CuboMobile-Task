import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  VoiceProvider,
  ProviderLeg,
  NormalizedCallEvent,
} from '../voice-provider.interface.js';
import { TelnyxWebhookParser } from './telnyx-webhook.parser.js';
import * as crypto from 'crypto';

@Injectable()
export class TelnyxProvider implements VoiceProvider {
  readonly providerName = 'telnyx';
  private readonly logger = new Logger(TelnyxProvider.name);
  private readonly apiKey: string;
  private readonly sipConnectionId: string;
  private readonly webhookSecret: string;
  private readonly baseUrl = 'https://api.telnyx.com/v2';

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly webhookParser: TelnyxWebhookParser,
  ) {
    this.apiKey = this.configService.get<string>('telnyx.apiKey', '');
    this.sipConnectionId = this.configService.get<string>(
      'telnyx.sipConnectionId',
      '',
    );
    this.webhookSecret = this.configService.get<string>(
      'telnyx.webhookSecret',
      '',
    );
  }

  async generateWebRTCToken(identity: string): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/telephony_credentials`,
          {
            connection_id: this.sipConnectionId,
            name: identity,
          },
          { headers: this.authHeaders() },
        ),
      );

      const credentialId = response.data.data.id;

      const tokenResponse = await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/telephony_credentials/${credentialId}/token`,
          {},
          { headers: this.authHeaders() },
        ),
      );

      return tokenResponse.data;
    } catch (error) {
      this.logger.error('Failed to generate WebRTC token', error);
      throw error;
    }
  }

  async dialPSTN(params: {
    from: string;
    to: string;
    webhookUrl: string;
    clientState?: string;
  }): Promise<ProviderLeg> {
    try {
      const body: Record<string, unknown> = {
        connection_id: this.sipConnectionId,
        to: params.to,
        from: params.from,
        webhook_url: params.webhookUrl,
      };

      if (params.clientState) {
        body.client_state = Buffer.from(params.clientState).toString('base64');
      }

      const response = await firstValueFrom(
        this.httpService.post(`${this.baseUrl}/calls`, body, {
          headers: this.authHeaders(),
        }),
      );

      return {
        providerCallControlId: response.data.data.call_control_id,
        providerSessionId: response.data.data.call_session_id,
      };
    } catch (error) {
      this.logger.error('Failed to dial PSTN', error);
      throw error;
    }
  }

  async bridge(params: {
    callControlIdA: string;
    callControlIdB: string;
  }): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/calls/${params.callControlIdA}/actions/bridge`,
          { call_control_id: params.callControlIdB },
          { headers: this.authHeaders() },
        ),
      );
    } catch (error) {
      this.logger.error('Failed to bridge calls', error);
      throw error;
    }
  }

  async hangup(callControlId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.httpService.post(
          `${this.baseUrl}/calls/${callControlId}/actions/hangup`,
          {},
          { headers: this.authHeaders() },
        ),
      );
    } catch (error) {
      this.logger.error('Failed to hangup call', error);
      throw error;
    }
  }

  parseWebhookEvent(rawPayload: unknown): NormalizedCallEvent | null {
    return this.webhookParser.parse(rawPayload);
  }

  verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      return true;
    }
    try {
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload)
        .digest('hex');
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature),
      );
    } catch {
      return false;
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
  }
}
