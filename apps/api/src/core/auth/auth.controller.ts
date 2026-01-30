import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@prisma/client';
import type { Request, Response } from 'express';

import type { UserResponse as SharedUserResponse } from '@amcore/shared';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { LoginDto, RegisterDto } from './dto';
import { JwtAuthGuard, JwtRefreshGuard } from './guards';
import { type SessionInfo, SessionService } from './session.service';
import { TokenService } from './token.service';

interface AuthResponse {
  user: SharedUserResponse;
  accessToken: string;
}

interface MessageResponse {
  message: string;
}

interface TokenResponse {
  accessToken: string;
}

interface ProfileResponse {
  user: SharedUserResponse | null;
}

interface SessionsResponse {
  sessions: SessionInfo[];
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
};

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register new user' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponse> {
    const result = await this.authService.register(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);

    return {
      user: result.user,
      accessToken: result.accessToken,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login user' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<AuthResponse> {
    const result = await this.authService.login(dto, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    res.cookie('refresh_token', result.refreshToken, COOKIE_OPTIONS);

    return {
      user: result.user,
      accessToken: result.accessToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Logout user' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response
  ): Promise<MessageResponse> {
    const refreshToken = req.cookies?.refresh_token;

    if (refreshToken) {
      const hashedToken = this.tokenService.hashRefreshToken(refreshToken);
      await this.authService.logout(hashedToken);
    }

    res.clearCookie('refresh_token', { path: '/api' });

    return { message: 'Вы успешно вышли из системы' };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtRefreshGuard)
  @ApiCookieAuth('refresh_token')
  @ApiOperation({ summary: 'Refresh access token' })
  async refresh(
    @Req() req: Request & { user: { user: User; refreshTokenHash: string } },
    @Res({ passthrough: true }) res: Response
  ): Promise<TokenResponse> {
    const { user, refreshTokenHash } = req.user;

    // Rotate refresh token
    const newRefreshToken = await this.sessionService.rotateRefreshToken(refreshTokenHash, {
      userId: user.id,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    // Generate new access token
    const accessToken = this.tokenService.generateAccessToken({
      sub: user.id,
      email: user.email,
    });

    res.cookie('refresh_token', newRefreshToken, COOKIE_OPTIONS);

    return { accessToken };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@CurrentUser() user: User): Promise<ProfileResponse> {
    const profile = await this.authService.getUserById(user.id);
    return { user: profile };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all active sessions' })
  async sessions(
    @CurrentUser('id') userId: string,
    @Req() req: Request
  ): Promise<SessionsResponse> {
    const refreshToken = req.cookies?.refresh_token;
    const currentHash = refreshToken ? this.tokenService.hashRefreshToken(refreshToken) : undefined;

    const sessions = await this.sessionService.getUserSessions(userId, currentHash);

    return { sessions };
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke specific session' })
  async revokeSession(
    @CurrentUser('id') userId: string,
    @Param('sessionId') sessionId: string
  ): Promise<MessageResponse> {
    await this.sessionService.deleteSession(sessionId, userId);
    return { message: 'Сессия отозвана' };
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke all sessions except current' })
  async revokeOtherSessions(
    @CurrentUser('id') userId: string,
    @Req() req: Request
  ): Promise<MessageResponse> {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      return { message: 'Нет активной сессии' };
    }

    const currentHash = this.tokenService.hashRefreshToken(refreshToken);
    await this.sessionService.deleteOtherSessions(userId, currentHash);

    return { message: 'Все остальные сессии отозваны' };
  }
}
