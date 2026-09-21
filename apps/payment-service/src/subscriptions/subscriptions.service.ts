import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as midtransClient from 'midtrans-client';
import { randomUUID, createHash } from 'crypto';
import { Subscription } from './entities/subscription.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { getPlan } from './plans.config';

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private snap: midtransClient.Snap;

  constructor(
    @InjectRepository(Subscription) private subscriptionsRepo: Repository<Subscription>,
    @InjectRepository(PaymentTransaction) private transactionsRepo: Repository<PaymentTransaction>,
  ) {
    this.snap = new midtransClient.Snap({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY ?? '',
      clientKey: process.env.MIDTRANS_CLIENT_KEY,
    });
  }

  async createCheckout(userId: string, userEmail: string, planType: string) {
    const plan = getPlan(planType);

    // Subscription dibuat dengan status "pending" DULU, sebelum user
    // benar-benar bayar — supaya ada baris untuk dikaitkan saat webhook
    // datang nanti. Kalau user batal bayar, baris ini tetap "pending"
    // selamanya (tidak masalah — tidak memberi akses apa pun).
    const subscription = this.subscriptionsRepo.create({
      userId,
      planType,
      status: 'pending',
    });
    await this.subscriptionsRepo.save(subscription);

    // order_id harus unik per transaksi di sisi Midtrans. Sisipkan subscription
    // id di dalamnya sekadar memudahkan debugging manual lewat dashboard
    // Midtrans — pencocokan sebenarnya tetap lewat kolom midtransOrderId.
    const orderId = `sub-${subscription.id}-${randomUUID().slice(0, 8)}`;

    const transaction = this.transactionsRepo.create({
      subscription,
      midtransOrderId: orderId,
      amount: plan.priceIdr,
      currency: 'IDR',
      status: 'pending',
    });
    await this.transactionsRepo.save(transaction);

    const midtransResult = await this.snap.createTransaction({
      transaction_details: { order_id: orderId, gross_amount: plan.priceIdr },
      customer_details: { email: userEmail },
    });

    return {
      subscriptionId: subscription.id,
      redirectUrl: midtransResult.redirect_url,
      snapToken: midtransResult.token,
    };
  }

  /**
   * Diproses lewat CoreApi.transaction.notification() dari SDK resmi Midtrans
   * — bukan verifikasi signature manual — karena SDK sudah menangani validasi
   * signature_key secara internal dan lebih tahan terhadap perubahan format
   * Midtrans di masa depan dibanding kita hitung ulang SHA-512 sendiri.
   */
  async handleWebhook(rawNotification: unknown): Promise<void> {
    const coreApi = new midtransClient.CoreApi({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY ?? '',
    });

    // SDK melempar error kalau signature tidak valid — request semacam ini
    // akan gagal di sini dan controller merespons 400, tanpa data apa pun
    // di database yang berubah.
    const statusResponse = await coreApi.transaction.notification(rawNotification);
    const orderId: string = statusResponse.order_id;
    const transactionStatus: string = statusResponse.transaction_status;
    const fraudStatus: string | undefined = statusResponse.fraud_status;

    const transaction = await this.transactionsRepo.findOne({
      where: { midtransOrderId: orderId },
      relations: ['subscription'],
    });

    if (!transaction) {
      this.logger.warn(`Webhook diterima untuk order_id tidak dikenal: ${orderId}`);
      return;
    }

    // Kalau user checkout dengan opsi "simpan kartu" (one-click/two-click),
    // Midtrans menyertakan saved_token_id di notifikasi — simpan supaya
    // RenewalService bisa coba charge otomatis nanti tanpa user input ulang.
    if (statusResponse.saved_token_id) {
      transaction.subscription.savedTokenId = statusResponse.saved_token_id;
      await this.subscriptionsRepo.save(transaction.subscription);
    }

    // Idempotency check: kalau transaksi ini sudah pernah diproses ke status
    // final (success/failed/expired), abaikan notifikasi duplikat. Midtrans
    // memang bisa mengirim notifikasi yang sama lebih dari sekali — tanpa
    // pengecekan ini, masa aktif subscription bisa ke-extend berkali-kali
    // dari satu pembayaran yang sama.
    if (['success', 'failed', 'expired', 'refunded'].includes(transaction.status)) {
      this.logger.log(`Notifikasi duplikat untuk ${orderId}, status sudah final: ${transaction.status}`);
      return;
    }

    const newStatus = this.mapMidtransStatus(transactionStatus, fraudStatus);
    transaction.status = newStatus;
    if (newStatus === 'success') {
      transaction.paidAt = new Date();
    }
    await this.transactionsRepo.save(transaction);

    await this.applyStatusToSubscription(transaction.subscription, newStatus, transaction.midtransOrderId);
  }

  private mapMidtransStatus(transactionStatus: string, fraudStatus?: string): string {
    // Referensi mapping status resmi dari dokumentasi Midtrans Snap.
    if (transactionStatus === 'capture') {
      return fraudStatus === 'accept' ? 'success' : 'failed';
    }
    if (transactionStatus === 'settlement') return 'success';
    if (transactionStatus === 'pending') return 'pending';
    if (['deny', 'cancel'].includes(transactionStatus)) return 'failed';
    if (transactionStatus === 'expire') return 'expired';
    if (transactionStatus === 'refund') return 'refunded';
    return 'pending';
  }

  private async applyStatusToSubscription(
    subscription: Subscription,
    transactionStatus: string,
    orderId: string,
  ): Promise<void> {
    if (transactionStatus !== 'success') {
      if (['failed', 'expired'].includes(transactionStatus)) {
        subscription.status = 'expired';
        await this.subscriptionsRepo.save(subscription);
      }
      return;
    }

    const plan = getPlan(subscription.planType);
    const now = new Date();
    // Kalau ini renewal dari subscription yang masih aktif (belum lewat
    // currentPeriodEnd), perpanjang DARI tanggal berakhir yang lama — bukan
    // dari sekarang — supaya user tidak "rugi" sisa hari kalau bayar lebih awal.
    const baseDate =
      subscription.currentPeriodEnd && subscription.currentPeriodEnd > now
        ? subscription.currentPeriodEnd
        : now;

    subscription.status = 'active';
    subscription.currentPeriodEnd = new Date(baseDate.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);
    await this.subscriptionsRepo.save(subscription);

    this.logger.log(`Subscription ${subscription.id} aktif sampai ${subscription.currentPeriodEnd.toISOString()} (order ${orderId})`);
  }

  async getSubscriptionStatus(userId: string) {
    // Ambil subscription TERBARU milik user — dalam kasus wajar cuma ada
    // satu per user, tapi kalau ada riwayat pending yang gagal, ambil yang
    // paling baru dibuat supaya representatif dengan kondisi terkini.
    const subscription = await this.subscriptionsRepo.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    if (!subscription) {
      return { status: 'none', currentPeriodEnd: null };
    }

    // Auto-expire di sisi baca: kalau currentPeriodEnd sudah lewat tapi
    // status di DB masih "active" (misal job renewal belum sempat jalan),
    // anggap sudah expired TANPA perlu nulis balik ke DB di sini — cukup
    // untuk keperluan pengecekan akses. Job terjadwal terpisah yang idealnya
    // menjaga konsistensi status di database.
    const isExpired = subscription.currentPeriodEnd && subscription.currentPeriodEnd < new Date();
    const effectiveStatus = isExpired && subscription.status === 'active' ? 'expired' : subscription.status;

    return {
      status: effectiveStatus,
      currentPeriodEnd: subscription.currentPeriodEnd,
    };
  }

  async cancelSubscription(userId: string): Promise<void> {
    const subscription = await this.subscriptionsRepo.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    if (!subscription) return; // idempotent — tidak ada yang aktif dianggap sukses

    // TIDAK langsung ubah status ke "cancelled" atau cabut akses — akses
    // tetap jalan sampai currentPeriodEnd, sesuai acceptance criteria User
    // Story 5. Flag ini yang membuat RenewalService berhenti coba charge
    // ulang di periode berikutnya.
    subscription.cancelAtPeriodEnd = true;
    await this.subscriptionsRepo.save(subscription);
  }

  async reactivateSubscription(userId: string): Promise<void> {
    const subscription = await this.subscriptionsRepo.findOne({
      where: { userId, status: 'active' },
      order: { createdAt: 'DESC' },
    });
    // Hanya bisa reaktivasi kalau periode yang sudah dibayar BELUM habis —
    // kalau sudah lewat currentPeriodEnd, itu bukan "reaktivasi" lagi tapi
    // subscription baru, harus lewat alur checkout dari awal.
    if (!subscription || !subscription.currentPeriodEnd || subscription.currentPeriodEnd < new Date()) {
      throw new BadRequestException('Tidak ada langganan aktif yang bisa diaktifkan kembali');
    }

    subscription.cancelAtPeriodEnd = false;
    await this.subscriptionsRepo.save(subscription);
  }

  /**
   * Dipanggil RenewalService (lihat renewal.service.ts) untuk subscription
   * yang periodenya sudah/segera habis dan punya kartu tersimpan. Memakai
   * Midtrans Core API charge dengan saved_token_id — ini alur "one-click"
   * Midtrans, BUKAN Snap biasa (Snap selalu butuh redirect user).
   */
  async chargeRenewal(subscription: Subscription): Promise<boolean> {
    if (!subscription.savedTokenId) return false;

    const plan = getPlan(subscription.planType);
    const orderId = `renewal-${subscription.id}-${randomUUID().slice(0, 8)}`;
    const coreApi = new midtransClient.CoreApi({
      isProduction: process.env.MIDTRANS_IS_PRODUCTION === 'true',
      serverKey: process.env.MIDTRANS_SERVER_KEY ?? '',
    });

    const transaction = this.transactionsRepo.create({
      subscription,
      midtransOrderId: orderId,
      amount: plan.priceIdr,
      currency: 'IDR',
      status: 'pending',
    });
    await this.transactionsRepo.save(transaction);

    try {
      // charge() bukan bagian dari deklarasi tipe CoreApi kita — Midtrans
      // SDK memang menyediakannya di instance CoreApi yang sama meski tidak
      // kita deklarasikan eksplisit di midtrans-client.d.ts. Di-cast ke any
      // di titik pemanggilan ini saja, supaya sisa kode tetap type-safe.
      const chargeResult = await (coreApi as any).charge({
        payment_type: 'credit_card',
        transaction_details: { order_id: orderId, gross_amount: plan.priceIdr },
        credit_card: { token_id: subscription.savedTokenId },
      });

      const success = ['capture', 'settlement'].includes(chargeResult.transaction_status);
      transaction.status = success ? 'success' : 'failed';
      if (success) {
        transaction.paidAt = new Date();
        await this.transactionsRepo.save(transaction);
        // Pakai logic yang SAMA dengan webhook checkout biasa — supaya
        // aturan "perpanjang dari currentPeriodEnd lama, bukan dari sekarang"
        // konsisten di kedua alur, tidak ada logic duplikat yang bisa drift.
        await this.applyStatusToSubscription(subscription, 'success', orderId);
      } else {
        await this.transactionsRepo.save(transaction);
      }

      return success;
    } catch (error) {
      this.logger.error(`Charge renewal gagal untuk subscription ${subscription.id}: ${error}`);
      transaction.status = 'failed';
      await this.transactionsRepo.save(transaction);
      return false;
    }
  }

  /**
   * Dipanggil RenewalService — cari subscription aktif yang currentPeriodEnd-nya
   * sudah lewat "gracePeriodEnd" (currentPeriodEnd + graceDays), TIDAK ditandai
   * cancelAtPeriodEnd, dan masih berstatus "active"/"past_due". Inilah kandidat
   * yang perlu di-charge ulang atau di-expire.
   */
  async findSubscriptionsPastPeriodEnd(): Promise<Subscription[]> {
    return this.subscriptionsRepo
      .createQueryBuilder('s')
      .where('s.status IN (:...statuses)', { statuses: ['active', 'past_due'] })
      .andWhere('s.cancel_at_period_end = false')
      .andWhere('s.current_period_end < :now', { now: new Date() })
      .getMany();
  }

  async markPastDue(subscription: Subscription): Promise<void> {
    subscription.status = 'past_due';
    await this.subscriptionsRepo.save(subscription);
  }

  async markExpired(subscription: Subscription): Promise<void> {
    subscription.status = 'expired';
    await this.subscriptionsRepo.save(subscription);
  }
}
