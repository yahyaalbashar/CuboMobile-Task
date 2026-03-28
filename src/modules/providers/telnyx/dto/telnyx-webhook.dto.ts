import { ApiProperty } from '@nestjs/swagger';

export class TelnyxWebhookPayloadDto {
  @ApiProperty()
  call_control_id!: string;

  @ApiProperty()
  call_session_id!: string;

  @ApiProperty()
  connection_id!: string;

  @ApiProperty()
  direction!: string;

  @ApiProperty({ required: false })
  client_state?: string;

  @ApiProperty({ required: false })
  from?: string;

  @ApiProperty({ required: false })
  to?: string;

  @ApiProperty({ required: false })
  hangup_cause?: string;

  @ApiProperty({ required: false })
  hangup_source?: string;
}

export class TelnyxWebhookDataDto {
  @ApiProperty()
  event_type!: string;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  payload!: TelnyxWebhookPayloadDto;
}

export class TelnyxWebhookDto {
  @ApiProperty()
  data!: TelnyxWebhookDataDto;
}
