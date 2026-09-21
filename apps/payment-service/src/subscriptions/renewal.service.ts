import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';

// 3 hari masa tenggang setelah currentPeriodEnd sebelum akses benar-benar
// dicabut — sesuai acceptance criteria User Story 4. Selama masa ini,
// status subscription "past_due": akses TETAP ditolak media-service (karena
// gating di sana hanya meloloskan status "active"), tapi user masih
// diberi kesempatan perbarui pembayaran sebelum datanya dianggap expired
// sepenuhnya.
const GRACE_PERIOD_DAYS = 3;

@Injectable()
export class RenewalService {
  private readonly logger = new Logger(RenewalService.name);

  constructor(private subscriptionsService: SubscriptionsService) {}

  // Jalan tiap hari jam 03:00 — di luar jam sibuk, dan cukup sering untuk
  // grace period 3 hari terasa akurat (bukan jam pastinya yang penting,
  // yang penting konsisten jalan tiap hari).
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleExpiredSubscriptions(): Promise<void> {
    const candidates = await this.subscriptionsService.findSubscriptionsPastPeriodEnd();
    this.logger.log(`Memproses ${candidates.length} subscription yang sudah lewat periode`);

    for (const subscription of candidates) {
      const daysPastEnd = this.daysSince(subscription.currentPeriodEnd!);

      if (daysPastEnd > GRACE_PERIOD_DAYS) {
        // Grace period habis tanpa pembayaran berhasil — akses dicabut
        // sepenuhnya. Tidak ada percobaan charge lagi setelah titik ini;
        // user harus checkout ulang dari awal kalau mau berlangganan lagi.
        await this.subscriptionsService.markExpired(subscription);
        this.logger.log(`Subscription ${subscription.id} expired (lewat grace period ${GRACE_PERIOD_DAYS} hari)`);
        continue;
      }

      // Masih dalam grace period — coba charge otomatis kalau ada kartu
      // tersimpan. TANPA kartu tersimpan (misal user bayar lewat transfer
      // bank/e-wallet yang tidak mendukung recurring), tidak ada yang bisa
      // di-charge otomatis — cukup ditandai past_due dan tunggu grace
      // period habis, kecuali user bayar manual lewat endpoint checkout lagi.
      const charged = await this.subscriptionsService.chargeRenewal(subscription);

      if (!charged) {
        await this.subscriptionsService.markPastDue(subscription);
        this.logger.log(
          `Subscription ${subscription.id} ditandai past_due (hari ke-${daysPastEnd} dari grace period, charge otomatis ${subscription.savedTokenId ? 'gagal' : 'tidak tersedia'})`,
        );
      }
      // Kalau charged === true, chargeRenewal() sudah memperpanjang periode
      // lewat alur yang sama seperti webhook checkout biasa — tidak perlu
      // aksi tambahan di sini.
    }
  }

  private daysSince(date: Date): number {
    return Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  }
}
