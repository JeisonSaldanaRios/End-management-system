import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

import { AuthService } from '../../auth/auth.service';
import { getAuthCookieOptions } from '../../auth/auth-cookie.options';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);
    const shouldRefreshSession = this.reflector.getAllAndOverride<boolean>('refreshSession', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    
    const token = request.cookies?.['auth_token'];
    if (!token) {
      throw new UnauthorizedException('Token requerido');
    }

    const payload = await this.authService.validateSession(token, request.ip ?? 'unknown');
    if (shouldRefreshSession) {
      const newToken = await this.authService.rotateSessionToken(token, payload);
      response.cookie('auth_token', newToken, getAuthCookieOptions());
      (request as Request & { refreshedToken?: string }).refreshedToken = newToken;
    }

    request.user = payload;
    return true;
  }
}
