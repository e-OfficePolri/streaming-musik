import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Subscription } from './entities/subscription.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { SubscriptionsService } from './subscriptions.service';
import { SubscriptionsController } from './subscriptions.controller';
import { RenewalService } from './renewal.service';
import { TokenBlocklistService } from '../common/token-blocklist.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([Subscription, PaymentTransaction]),
    // Aktifkan @Cron() di RenewalService. Catatan penting untuk produksi:
    // kalau payment-service di-scale ke >1 task ECS, job ini akan jalan
    // di SETIAP task secara bersamaan (duplikat). Untuk MVP dengan 2 task
    // ini menghasilkan pekerjaan dobel yang boros tapi tidak salah secara
    // data (idempotent lewat pengecekan status). Untuk produksi matang,
    // pindahkan ke EventBridge Scheduler + Lambda/ECS task terpisah yang
    // jalan sekali, bukan @Cron() di dalam service yang di-scale horizontal.
    ScheduleModule.forRoot(),
    // JWT_SECRET HARUS SAMA PERSIS dengan yang dipakai auth-service — kedua
    // service memverifikasi token yang sama, ditandatangani oleh auth-service.
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'ganti-di-produksi',
    }),
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService, RenewalService, TokenBlocklistService, JwtAuthGuard],
})
export class SubscriptionsModule {}
