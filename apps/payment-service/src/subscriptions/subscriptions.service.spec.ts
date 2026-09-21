// Mock TOTAL modul midtrans-client — kita TIDAK menguji apakah SDK Midtrans
// benar (itu tanggung jawab mereka), kita menguji apakah SubscriptionsService
// bereaksi dengan benar terhadap berbagai kemungkinan respons dari SDK itu.
// mockCreateTransaction/mockNotification/mockCharge diekspos lewat properti
// __mock* supaya tiap test bisa atur nilai baliknya sendiri.
jest.mock('midtrans-client', () => {
  const mockCreateTransaction = jest.fn();
  const mockNotification = jest.fn();
  const mockCharge = jest.fn();
  return {
    Snap: jest.fn().mockImplementation(() => ({ createTransaction: mockCreateTransaction })),
    CoreApi: jest.fn().mockImplementation(() => ({
      transaction: { notification: mockNotification },
      charge: mockCharge,
    })),
    __mockCreateTransaction: mockCreateTransaction,
    __mockNotification: mockNotification,
    __mockCharge: mockCharge,
  };
});

import { BadRequestException } from '@nestjs/common';
import * as midtransClient from 'midtrans-client';
import { SubscriptionsService } from './subscriptions.service';

const mockCreateTransaction = (midtransClient as any).__mockCreateTransaction;
const mockNotification = (midtransClient as any).__mockNotification;
const mockCharge = (midtransClient as any).__mockCharge;

function createMockSubscriptionsRepo() {
  const queryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  return {
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: entity.id ?? 'generated-id', ...entity })),
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(() => queryBuilder),
    __queryBuilder: queryBuilder,
  };
}

function createMockTransactionsRepo() {
  return {
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: entity.id ?? 'generated-id', ...entity })),
    findOne: jest.fn(),
  };
}

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let subscriptionsRepo: ReturnType<typeof createMockSubscriptionsRepo>;
  let transactionsRepo: ReturnType<typeof createMockTransactionsRepo>;

  beforeEach(() => {
    jest.clearAllMocks();
    subscriptionsRepo = createMockSubscriptionsRepo();
    transactionsRepo = createMockTransactionsRepo();
    service = new SubscriptionsService(subscriptionsRepo as any, transactionsRepo as any);
  });

  describe('createCheckout', () => {
    it('membuat subscription berstatus pending SEBELUM user bayar', async () => {
      mockCreateTransaction.mockResolvedValue({ token: 'snap-token', redirect_url: 'https://midtrans.example/pay' });

      await service.createCheckout('user-1', 'user@example.com', 'premium_monthly');

      expect(subscriptionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', planType: 'premium_monthly', status: 'pending' }),
      );
    });

    it('mengirim gross_amount ke Midtrans sesuai harga plan (bukan nilai sembarang dari client)', async () => {
      mockCreateTransaction.mockResolvedValue({ token: 't', redirect_url: 'https://x' });

      await service.createCheckout('user-1', 'user@example.com', 'premium_monthly');

      expect(mockCreateTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          transaction_details: expect.objectContaining({ gross_amount: 49000 }),
        }),
      );
    });

    it('menolak plan yang tidak dikenal, TANPA membuat subscription/transaction apa pun', async () => {
      await expect(service.createCheckout('user-1', 'user@example.com', 'plan-ngasal')).rejects.toThrow();
      expect(subscriptionsRepo.save).not.toHaveBeenCalled();
    });

    it('mengembalikan redirectUrl dan snapToken dari hasil Midtrans', async () => {
      mockCreateTransaction.mockResolvedValue({ token: 'abc123', redirect_url: 'https://midtrans.example/pay/xyz' });

      const result = await service.createCheckout('user-1', 'user@example.com', 'premium_monthly');

      expect(result.snapToken).toBe('abc123');
      expect(result.redirectUrl).toBe('https://midtrans.example/pay/xyz');
    });
  });

  describe('handleWebhook', () => {
    it('mengabaikan notifikasi untuk order_id yang tidak dikenal, tanpa menyentuh database', async () => {
      mockNotification.mockResolvedValue({ order_id: 'order-tidak-dikenal', transaction_status: 'settlement' });
      transactionsRepo.findOne.mockResolvedValue(null);

      await service.handleWebhook({ some: 'payload' });

      expect(transactionsRepo.save).not.toHaveBeenCalled();
      expect(subscriptionsRepo.save).not.toHaveBeenCalled();
    });

    it('IDEMPOTENT — mengabaikan notifikasi duplikat kalau transaksi sudah berstatus final', async () => {
      mockNotification.mockResolvedValue({ order_id: 'order-1', transaction_status: 'settlement' });
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-1',
        status: 'success', // sudah final
        subscription: { id: 'sub-1', planType: 'premium_monthly' },
      });

      await service.handleWebhook({ some: 'payload' });

      // Tidak ada save tambahan — notifikasi duplikat TIDAK memperpanjang
      // masa aktif subscription lagi.
      expect(transactionsRepo.save).not.toHaveBeenCalled();
      expect(subscriptionsRepo.save).not.toHaveBeenCalled();
    });

    it('settlement pertama kali: transaksi ditandai success DAN subscription jadi active', async () => {
      mockNotification.mockResolvedValue({ order_id: 'order-1', transaction_status: 'settlement' });
      const subscription = { id: 'sub-1', planType: 'premium_monthly', currentPeriodEnd: null };
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-1',
        status: 'pending',
        subscription,
      });

      await service.handleWebhook({ some: 'payload' });

      expect(transactionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', paidAt: expect.any(Date) }),
      );
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'active', currentPeriodEnd: expect.any(Date) }),
      );
    });

    it('RENEWAL ADIL — perpanjangan dihitung dari currentPeriodEnd LAMA, bukan dari sekarang, kalau belum kedaluwarsa', async () => {
      const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000); // 10 hari lagi
      mockNotification.mockResolvedValue({ order_id: 'order-2', transaction_status: 'settlement' });
      const subscription = { id: 'sub-1', planType: 'premium_monthly', currentPeriodEnd: futureDate };
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-2',
        status: 'pending',
        subscription,
      });

      await service.handleWebhook({ some: 'payload' });

      const savedSubscription = subscriptionsRepo.save.mock.calls[0][0];
      const expectedNewEnd = futureDate.getTime() + 30 * 24 * 60 * 60 * 1000; // plan premium_monthly = 30 hari
      // Toleransi beberapa milidetik untuk waktu eksekusi test itu sendiri.
      expect(Math.abs(savedSubscription.currentPeriodEnd.getTime() - expectedNewEnd)).toBeLessThan(1000);
    });

    it('capture dengan fraud_status "accept" dianggap sukses', async () => {
      mockNotification.mockResolvedValue({ order_id: 'order-3', transaction_status: 'capture', fraud_status: 'accept' });
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-3',
        status: 'pending',
        subscription: { id: 'sub-1', planType: 'premium_monthly', currentPeriodEnd: null },
      });

      await service.handleWebhook({ some: 'payload' });

      expect(transactionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }));
    });

    it('capture dengan fraud_status "challenge" (BUKAN accept) dianggap gagal', async () => {
      mockNotification.mockResolvedValue({ order_id: 'order-4', transaction_status: 'capture', fraud_status: 'challenge' });
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-4',
        status: 'pending',
        subscription: { id: 'sub-1', planType: 'premium_monthly', currentPeriodEnd: null },
      });

      await service.handleWebhook({ some: 'payload' });

      expect(transactionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });

    it('transaction_status "deny" membuat subscription berstatus expired', async () => {
      mockNotification.mockResolvedValue({ order_id: 'order-5', transaction_status: 'deny' });
      const subscription = { id: 'sub-1', planType: 'premium_monthly', currentPeriodEnd: null, status: 'pending' };
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-5',
        status: 'pending',
        subscription,
      });

      await service.handleWebhook({ some: 'payload' });

      expect(subscriptionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    });

    it('menyimpan saved_token_id kalau Midtrans mengirimkannya (fitur one-click)', async () => {
      mockNotification.mockResolvedValue({
        order_id: 'order-6',
        transaction_status: 'settlement',
        saved_token_id: 'token-kartu-abc',
      });
      const subscription = { id: 'sub-1', planType: 'premium_monthly', currentPeriodEnd: null };
      transactionsRepo.findOne.mockResolvedValue({
        midtransOrderId: 'order-6',
        status: 'pending',
        subscription,
      });

      await service.handleWebhook({ some: 'payload' });

      expect(subscriptionsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ savedTokenId: 'token-kartu-abc' }),
      );
    });
  });

  describe('cancelSubscription & reactivateSubscription', () => {
    it('cancel bersifat idempotent — tidak ada subscription aktif dianggap sukses tanpa error', async () => {
      subscriptionsRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelSubscription('user-1')).resolves.toBeUndefined();
      expect(subscriptionsRepo.save).not.toHaveBeenCalled();
    });

    it('cancel MENGESET cancelAtPeriodEnd, TIDAK langsung mengubah status jadi cancelled', async () => {
      subscriptionsRepo.findOne.mockResolvedValue({ id: 'sub-1', status: 'active', cancelAtPeriodEnd: false });

      await service.cancelSubscription('user-1');

      const saved = subscriptionsRepo.save.mock.calls[0][0];
      expect(saved.cancelAtPeriodEnd).toBe(true);
      expect(saved.status).toBe('active'); // status TIDAK berubah — akses tetap jalan
    });

    it('reactivate menolak kalau tidak ada subscription aktif', async () => {
      subscriptionsRepo.findOne.mockResolvedValue(null);

      await expect(service.reactivateSubscription('user-1')).rejects.toThrow(BadRequestException);
    });

    it('reactivate menolak kalau currentPeriodEnd sudah lewat (bukan lagi kasus reaktivasi)', async () => {
      subscriptionsRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        currentPeriodEnd: new Date(Date.now() - 1000),
      });

      await expect(service.reactivateSubscription('user-1')).rejects.toThrow(BadRequestException);
    });

    it('reactivate berhasil kalau periode belum habis', async () => {
      subscriptionsRepo.findOne.mockResolvedValue({
        id: 'sub-1',
        status: 'active',
        cancelAtPeriodEnd: true,
        currentPeriodEnd: new Date(Date.now() + 100000),
      });

      await service.reactivateSubscription('user-1');

      expect(subscriptionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ cancelAtPeriodEnd: false }));
    });
  });

  describe('getSubscriptionStatus', () => {
    it('mengembalikan status "none" kalau user belum pernah subscription', async () => {
      subscriptionsRepo.findOne.mockResolvedValue(null);

      await expect(service.getSubscriptionStatus('user-1')).resolves.toEqual({
        status: 'none',
        currentPeriodEnd: null,
      });
    });

    it('auto-expire di sisi baca — status "active" dengan currentPeriodEnd lewat dianggap "expired" TANPA menulis ke DB', async () => {
      subscriptionsRepo.findOne.mockResolvedValue({
        status: 'active',
        currentPeriodEnd: new Date(Date.now() - 1000),
      });

      const result = await service.getSubscriptionStatus('user-1');

      expect(result.status).toBe('expired');
      expect(subscriptionsRepo.save).not.toHaveBeenCalled(); // murni baca, tidak menulis
    });

    it('status "active" dengan currentPeriodEnd di masa depan tetap "active"', async () => {
      subscriptionsRepo.findOne.mockResolvedValue({
        status: 'active',
        currentPeriodEnd: new Date(Date.now() + 100000),
      });

      await expect(service.getSubscriptionStatus('user-1')).resolves.toMatchObject({ status: 'active' });
    });
  });

  describe('chargeRenewal', () => {
    it('tanpa savedTokenId, langsung return false TANPA membuat transaksi apa pun', async () => {
      const subscription = { id: 'sub-1', planType: 'premium_monthly', savedTokenId: null };

      const result = await service.chargeRenewal(subscription as any);

      expect(result).toBe(false);
      expect(transactionsRepo.save).not.toHaveBeenCalled();
      expect(mockCharge).not.toHaveBeenCalled();
    });

    it('charge berhasil (settlement) memperpanjang periode subscription dan return true', async () => {
      mockCharge.mockResolvedValue({ transaction_status: 'settlement' });
      const subscription = {
        id: 'sub-1',
        planType: 'premium_monthly',
        savedTokenId: 'token-abc',
        currentPeriodEnd: new Date(Date.now() - 1000), // sudah lewat, kandidat renewal
      };

      const result = await service.chargeRenewal(subscription as any);

      expect(result).toBe(true);
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
    });

    it('charge gagal (deny) mengembalikan false TANPA mengubah status subscription', async () => {
      mockCharge.mockResolvedValue({ transaction_status: 'deny' });
      const subscription = {
        id: 'sub-1',
        planType: 'premium_monthly',
        savedTokenId: 'token-abc',
        currentPeriodEnd: new Date(Date.now() - 1000),
      };

      const result = await service.chargeRenewal(subscription as any);

      expect(result).toBe(false);
      // RenewalService yang bertanggung jawab set status past_due/expired
      // setelah ini — chargeRenewal sendiri tidak menyentuh subscription
      // kalau chargenya gagal.
      expect(subscriptionsRepo.save).not.toHaveBeenCalled();
    });

    it('exception saat charge (misal network error) ditangkap, transaksi ditandai failed, return false', async () => {
      mockCharge.mockRejectedValue(new Error('Network timeout'));
      const subscription = {
        id: 'sub-1',
        planType: 'premium_monthly',
        savedTokenId: 'token-abc',
        currentPeriodEnd: new Date(Date.now() - 1000),
      };

      const result = await service.chargeRenewal(subscription as any);

      expect(result).toBe(false);
      expect(transactionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    });
  });

  describe('markPastDue & markExpired', () => {
    it('markPastDue mengubah status jadi past_due', async () => {
      const subscription = { id: 'sub-1', status: 'active' };
      await service.markPastDue(subscription as any);
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'past_due' }));
    });

    it('markExpired mengubah status jadi expired', async () => {
      const subscription = { id: 'sub-1', status: 'past_due' };
      await service.markExpired(subscription as any);
      expect(subscriptionsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
    });
  });
});
