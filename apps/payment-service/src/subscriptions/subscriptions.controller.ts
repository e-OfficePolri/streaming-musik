import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';
import { CreateCheckoutDto } from './dto/create-checkout.dto';
import { JwtAuthGuard, AuthenticatedRequest } from '../common/jwt-auth.guard';

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private subscriptionsService: SubscriptionsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  createCheckout(@Req() req: AuthenticatedRequest, @Body() dto: CreateCheckoutDto) {
    return this.subscriptionsService.createCheckout(req.user.sub, req.user.email, dto.planType);
  }

  // Dipanggil web/mobile app untuk tampilkan status langganan ke user, DAN
  // dipanggil media-service (dengan bearer token milik user yang sama, di-
  // forward apa adanya) sebagai sumber kebenaran sebelum generate signed URL
  // streaming — lihat GatingMiddleware di media-service.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  getMySubscription(@Req() req: AuthenticatedRequest) {
    return this.subscriptionsService.getSubscriptionStatus(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Post('cancel')
  async cancel(@Req() req: AuthenticatedRequest) {
    await this.subscriptionsService.cancelSubscription(req.user.sub);
    return { message: 'Langganan dibatalkan. Akses tetap aktif sampai akhir periode yang sudah dibayar.' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('reactivate')
  async reactivate(@Req() req: AuthenticatedRequest) {
    await this.subscriptionsService.reactivateSubscription(req.user.sub);
    return { message: 'Langganan diaktifkan kembali.' };
  }

  // TIDAK pakai JwtAuthGuard — endpoint ini dipanggil langsung oleh server
  // Midtrans, bukan oleh user yang login. Keamanannya bergantung pada
  // verifikasi signature di dalam SubscriptionsService.handleWebhook(),
  // bukan JWT.
  @Post('webhook/midtrans')
  @HttpCode(200) // Midtrans expect 200 OK untuk tandai notifikasi diterima
  async handleMidtransWebhook(@Body() body: unknown) {
    await this.subscriptionsService.handleWebhook(body);
    return { received: true };
  }
}
