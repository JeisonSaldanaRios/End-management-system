import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthenticatedOnly, Public, RefreshSession } from '../common/decorators';
import { ApiOkResponseData, ApiOkResponseMessage } from '../common/swagger/api-response.decorator';
import { ForgotPasswordDto, LoginDto, LoginResponseDataDto, ResetPasswordDto } from './dto';
import type { JwtPayload } from './auth.model';
import { AuthService } from './auth.service';
import { getAuthCookieOptions } from './auth-cookie.options';

@Controller('auth')
@ApiTags('Auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  @ApiOperation({
    summary: 'Login and create a session',
    description:
      'Public endpoint. Returns a JWT that must be sent as Authorization: Bearer <token> for protected operations.',
  })
  @ApiBody({ type: LoginDto })
  @ApiOkResponseData(LoginResponseDataDto, { description: 'Login successful' })
  @ApiBadRequestResponse({ description: 'Incomplete credentials' })
  @ApiUnauthorizedResponse({ description: 'Invalid credentials' })
  async login(@Body() body: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const data = await this.service.login(body, req.ip ?? 'unknown');
    
    res.cookie('auth_token', data.token, getAuthCookieOptions());

    const { token, ...userData } = data;
    return { success: true, data: userData };
  }

  @Post('logout')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Logout and close the current session',
    description: 'Requires any authenticated user. Closes the active session for the provided JWT.',
  })
  @ApiOkResponseMessage({ description: 'Logged out successfully' })
  @ApiBadRequestResponse({ description: 'Missing or invalid Authorization header' })
  @ApiUnauthorizedResponse({ description: 'Invalid session' })
  async logout(@Req() req: Request & { refreshedToken?: string }, @Res({ passthrough: true }) res: Response) {
    const token = req.refreshedToken ?? req.cookies?.['auth_token'];
    if (!token) {
      throw new BadRequestException('Missing token');
    }

    await this.service.logout(token, req.ip ?? 'unknown');
    
    res.clearCookie('auth_token', getAuthCookieOptions());
    
    return { success: true, message: 'Logged out successfully' };
  }

  @Get('check-session')
  @AuthenticatedOnly()
  @RefreshSession()
  @ApiOperation({
    summary: 'Check current session',
    description:
      'Requires any authenticated user. If valid, returns active=true and refreshes the JWT in the Authorization response header.',
  })
  @ApiOkResponse({
    description: 'Session is active',
    schema: {
      example: {
        success: true,
        data: {
          active: true,
        },
      },
    },
  })
  @ApiUnauthorizedResponse({ description: 'Missing, invalid, or expired token' })
  async checkSession() {
    return {
      success: true,
      data: {
        active: true,
      },
    };
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @Post('forgot-password')
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Public endpoint. Always returns a generic message to avoid leaking whether an email is registered.',
  })
  @ApiBody({ type: ForgotPasswordDto })
  @ApiOkResponseMessage({ description: 'Password reset request accepted' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async forgotPassword(@Body() body: ForgotPasswordDto, @Req() req: Request) {
    await this.service.forgotPassword(body.username, body.email, body.campId, req.ip ?? 'unknown');
    return {
      success: true,
      message:
        'Si el correo pertenece a un usuario registrado, recibiras instrucciones para restablecer la contrasena.',
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('reset-password')
  @ApiOperation({
    summary: 'Reset password',
    description: 'Public endpoint. Uses a valid password reset code sent to the user.',
  })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponseMessage({ description: 'Password updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid or expired code, or invalid password' })
  async resetPassword(@Body() body: ResetPasswordDto, @Req() req: Request) {
    await this.service.resetPassword(
      body.username,
      body.email,
      body.campId,
      body.code,
      body.newPassword,
      req.ip ?? 'unknown',
    );
    return {
      success: true,
      message: 'Contrasena actualizada correctamente',
    };
  }

  @Get('me')
  @AuthenticatedOnly()
  @ApiOperation({
    summary: 'Get current user profile and session details',
    description: 'Returns the session details of the authenticated user, including their linked Person profile with a fresh image signed URL.',
  })
  @ApiOkResponse({ description: 'Profile details retrieved successfully' })
  async getMe(@Req() req: Request & { user: JwtPayload }) {
    const data = await this.service.getMe(req.user.userId);
    return { success: true, data };
  }

  @Put('me/photo')
  @AuthenticatedOnly()
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Update current user profile photo',
    description: 'Updates the photo of the Person linked to the current authenticated User.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Photo updated successfully' })
  async updateMyPhoto(
    @Req() req: Request & { user: JwtPayload },
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    const result = await this.service.updateMyPhoto(req.user.userId, file);
    return {
      success: true,
      data: result,
    };
  }
}
