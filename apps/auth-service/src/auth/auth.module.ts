import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { Device } from './entities/device.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LoginRateLimitService } from '../common/login-rate-limit.service';
import { EmailService } from '../common/email.service';
import { TokenBlocklistService } from '../common/token-blocklist.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, PasswordResetToken, Device]),
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'ganti-di-produksi',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LoginRateLimitService, EmailService, TokenBlocklistService, JwtAuthGuard],
})
export class AuthModule {}
