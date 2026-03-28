import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CallStatus } from '../enums/call-status.enum.js';

export class CallLegResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() legType!: string;
  @ApiProperty() providerCallControlId!: string;
  @ApiPropertyOptional() providerSessionId?: string | null;
  @ApiProperty() status!: string;
  @ApiProperty() createdAt!: Date;
}

export class CallEventResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() providerEventType!: string;
  @ApiProperty() receivedAt!: Date;
}

export class CallResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() provider!: string;
  @ApiProperty() sourceNumber!: string;
  @ApiProperty() destinationNumber!: string;
  @ApiProperty({ enum: CallStatus }) status!: CallStatus;
  @ApiPropertyOptional() failureReason?: string | null;
  @ApiProperty() createdAt!: Date;
  @ApiPropertyOptional() startedAt?: Date | null;
  @ApiPropertyOptional() answeredAt?: Date | null;
  @ApiPropertyOptional() endedAt?: Date | null;
  @ApiPropertyOptional() durationSeconds?: number | null;
  @ApiPropertyOptional({ type: [CallLegResponseDto] }) legs?: CallLegResponseDto[];
  @ApiPropertyOptional({ type: [CallEventResponseDto] }) events?: CallEventResponseDto[];
}

export class PaginatedCallsResponseDto {
  @ApiProperty({ type: [CallResponseDto] }) data!: CallResponseDto[];
  @ApiProperty() total!: number;
  @ApiProperty() page!: number;
  @ApiProperty() limit!: number;
}
