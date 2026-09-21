import { RenewalService } from './renewal.service';
import { SubscriptionsService } from './subscriptions.service';

function createMockSubscriptionsService() {
  return {
    findSubscriptionsPastPeriodEnd: jest.fn(),
    chargeRenewal: jest.fn(),
    markPastDue: jest.fn().mockResolvedValue(undefined),
    markExpired: jest.fn().mockResolvedValue(undefined),
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('RenewalService', () => {
  let service: RenewalService;
  let subscriptionsService: ReturnType<typeof createMockSubscriptionsService>;

  beforeEach(() => {
    subscriptionsService = createMockSubscriptionsService();
    service = new RenewalService(subscriptionsService as unknown as SubscriptionsService);
  });

  it('tidak melakukan apa pun kalau tidak ada subscription yang perlu diproses', async () => {
    subscriptionsService.findSubscriptionsPastPeriodEnd.mockResolvedValue([]);

    await service.handleExpiredSubscriptions();

    expect(subscriptionsService.chargeRenewal).not.toHaveBeenCalled();
    expect(subscriptionsService.markPastDue).not.toHaveBeenCalled();
    expect(subscriptionsService.markExpired).not.toHaveBeenCalled();
  });

  it('MASIH dalam grace period (1 hari lewat dari 3 hari): coba charge, gagal -> ditandai past_due', async () => {
    const subscription = { id: 'sub-1', currentPeriodEnd: daysAgo(1), savedTokenId: 'token-abc' };
    subscriptionsService.findSubscriptionsPastPeriodEnd.mockResolvedValue([subscription]);
    subscriptionsService.chargeRenewal.mockResolvedValue(false);

    await service.handleExpiredSubscriptions();

    expect(subscriptionsService.chargeRenewal).toHaveBeenCalledWith(subscription);
    expect(subscriptionsService.markPastDue).toHaveBeenCalledWith(subscription);
    expect(subscriptionsService.markExpired).not.toHaveBeenCalled();
  });

  it('MASIH dalam grace period, charge BERHASIL -> TIDAK ditandai past_due (sudah ditangani chargeRenewal)', async () => {
    const subscription = { id: 'sub-1', currentPeriodEnd: daysAgo(1), savedTokenId: 'token-abc' };
    subscriptionsService.findSubscriptionsPastPeriodEnd.mockResolvedValue([subscription]);
    subscriptionsService.chargeRenewal.mockResolvedValue(true);

    await service.handleExpiredSubscriptions();

    expect(subscriptionsService.markPastDue).not.toHaveBeenCalled();
    expect(subscriptionsService.markExpired).not.toHaveBeenCalled();
  });

  it('SUDAH LEWAT grace period (4 hari > batas 3 hari) -> langsung expired, TIDAK coba charge lagi', async () => {
    const subscription = { id: 'sub-1', currentPeriodEnd: daysAgo(4), savedTokenId: 'token-abc' };
    subscriptionsService.findSubscriptionsPastPeriodEnd.mockResolvedValue([subscription]);

    await service.handleExpiredSubscriptions();

    expect(subscriptionsService.chargeRenewal).not.toHaveBeenCalled();
    expect(subscriptionsService.markExpired).toHaveBeenCalledWith(subscription);
  });

  it('tanpa savedTokenId (bayar manual sebelumnya, bukan kartu tersimpan) -> tetap dicoba chargeRenewal, yang akan return false, lalu past_due', async () => {
    const subscription = { id: 'sub-1', currentPeriodEnd: daysAgo(1), savedTokenId: null };
    subscriptionsService.findSubscriptionsPastPeriodEnd.mockResolvedValue([subscription]);
    subscriptionsService.chargeRenewal.mockResolvedValue(false); // chargeRenewal sendiri yang menolak karena tidak ada token

    await service.handleExpiredSubscriptions();

    expect(subscriptionsService.markPastDue).toHaveBeenCalledWith(subscription);
  });

  it('memproses banyak subscription independen satu sama lain', async () => {
    const subActive = { id: 'sub-1', currentPeriodEnd: daysAgo(1), savedTokenId: 'token-1' };
    const subExpired = { id: 'sub-2', currentPeriodEnd: daysAgo(5), savedTokenId: 'token-2' };
    subscriptionsService.findSubscriptionsPastPeriodEnd.mockResolvedValue([subActive, subExpired]);
    subscriptionsService.chargeRenewal.mockResolvedValue(false);

    await service.handleExpiredSubscriptions();

    expect(subscriptionsService.markPastDue).toHaveBeenCalledWith(subActive);
    expect(subscriptionsService.markExpired).toHaveBeenCalledWith(subExpired);
    // subExpired TIDAK ikut di-charge karena sudah lewat grace period
    expect(subscriptionsService.chargeRenewal).toHaveBeenCalledTimes(1);
    expect(subscriptionsService.chargeRenewal).toHaveBeenCalledWith(subActive);
  });
});
