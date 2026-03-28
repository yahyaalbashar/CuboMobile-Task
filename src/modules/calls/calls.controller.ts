import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { CallsService } from './calls.service.js';
import { GetCallsDto } from './dto/get-calls.dto.js';
import {
  CallResponseDto,
  PaginatedCallsResponseDto,
} from './dto/call-response.dto.js';

@ApiTags('Calls')
@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated call history' })
  @ApiResponse({ status: 200, type: PaginatedCallsResponseDto })
  async getCalls(@Query() dto: GetCallsDto): Promise<PaginatedCallsResponseDto> {
    return this.callsService.getCalls(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get full call details with legs and events' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, type: CallResponseDto })
  @ApiResponse({ status: 404, description: 'Call not found' })
  async getCall(@Param('id', ParseUUIDPipe) id: string): Promise<CallResponseDto> {
    return this.callsService.getCallById(id) as unknown as CallResponseDto;
  }

  @Post(':id/hangup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Terminate an active call (idempotent)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  @ApiResponse({ status: 200, description: 'Call terminated' })
  @ApiResponse({ status: 404, description: 'Call not found' })
  async hangupCall(@Param('id', ParseUUIDPipe) id: string): Promise<{ message: string }> {
    await this.callsService.hangupCall(id);
    return { message: 'Call hangup initiated' };
  }
}
