import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { TokenBlocklistService } from './token-blocklist.service';

export interface AuthenticatedRequest extends Request {
  user: { sub: string; email: string; jti: string };
}

// Sama seperti di auth-service — lihat TODO di token-blocklist.service.ts
// soal rencana konsolidasi ke shared package.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private blocklistService: TokenBlocklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException('Token tidak ditemukan');
    }

    let payload: { sub: string; email: string; jti: string };
    try {
      payload = this.jwtService.verify(token);
    } catch {
      throw new UnauthorizedException('Token tidak valid atau kedaluwarsa');
    }

    if (await this.blocklistService.isRevoked(payload.jti)) {
      throw new UnauthorizedException('Sesi ini sudah dicabut, silakan login ulang');
    }

    request.user = payload;
    return true;
  }
}
