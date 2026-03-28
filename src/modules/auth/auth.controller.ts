import { Controller, Post, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { AuthService } from './auth.service.js';

export class WebRTCTokenRequestDto {
  @IsString()
  @IsNotEmpty()
  identity!: string;
}

export class WebRTCTokenResponseDto {
  token!: string;
  identity!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('webrtc-token')
  @ApiOperation({ summary: 'Generate a WebRTC token for browser SDK authentication' })
  @ApiBody({ type: WebRTCTokenRequestDto })
  @ApiResponse({ status: 201, type: WebRTCTokenResponseDto })
  async getWebRTCToken(
    @Body() body: WebRTCTokenRequestDto,
  ): Promise<WebRTCTokenResponseDto> {
    return this.authService.generateWebRTCToken(body.identity);
  }
}
