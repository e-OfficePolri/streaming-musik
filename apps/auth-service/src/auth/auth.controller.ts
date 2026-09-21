import { Body, Controller, Delete, Get, Ip, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { ForgotPasswordDto, ResetPasswordDto } from './dto/password-reset.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../common/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto.email, dto.password, dto.displayName);
  }

  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto.email, dto.password, ip, dto.deviceName);
  }

  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.requestPasswordReset(dto.email);
    // Pesan SELALU sama, tidak peduli email terdaftar atau tidak —
    // ini yang mencegah user enumeration, bukan logic di service.
    return { message: 'Kalau email terdaftar, link reset password sudah dikirim.' };
  }

  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return { message: 'Password berhasil diubah. Silakan login dengan password baru.' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('devices')
  listDevices(@Req() req: AuthenticatedRequest) {
    return this.authService.listDevices(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('devices/:id')
  async logoutDevice(@Req() req: AuthenticatedRequest, @Param('id') deviceId: string) {
    await this.authService.logoutDevice(req.user.sub, deviceId);
    return { message: 'Device berhasil di-logout.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('devices/logout-others')
  async logoutOtherDevices(@Req() req: AuthenticatedRequest) {
    await this.authService.logoutOtherDevices(req.user.sub, req.user.jti);
    return { message: 'Semua perangkat lain berhasil di-logout.' };
  }
}
