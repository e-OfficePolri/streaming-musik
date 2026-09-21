jest.mock('ioredis', () => require('ioredis-mock'));

import { HttpStatus } from '@nestjs/common';
import { LoginRateLimitService } from './login-rate-limit.service';

describe('LoginRateLimitService', () => {
  let service: LoginRateLimitService;

  beforeEach(() => {
    service = new LoginRateLimitService();
  });

  // ioredis-mock berbagi state di seluruh instance dalam satu proses
  // (meniru perilaku koneksi ke server Redis sungguhan) — tanpa dibersihkan,
  // percobaan gagal dari satu test bisa "bocor" ke test berikutnya.
  afterEach(async () => {
    await (service as any).redis.flushall();
  });

  it('mengizinkan login saat belum ada percobaan gagal', async () => {
    await expect(service.assertNotRateLimited('user@example.com', '127.0.0.1')).resolves.toBeUndefined();
  });

  it('mengizinkan sampai tepat di bawah batas maksimum (4 dari 5 percobaan)', async () => {
    const email = 'user@example.com';
    const ip = '127.0.0.1';

    for (let i = 0; i < 4; i++) {
      await service.recordFailedAttempt(email, ip);
    }

    await expect(service.assertNotRateLimited(email, ip)).resolves.toBeUndefined();
  });

  it('memblokir setelah 5 percobaan gagal dengan status 429', async () => {
    const email = 'user@example.com';
    const ip = '127.0.0.1';

    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt(email, ip);
    }

    await expect(service.assertNotRateLimited(email, ip)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('mengunci berdasarkan kombinasi email+IP — email sama dari IP lain TIDAK ikut terblokir', async () => {
    const email = 'user@example.com';

    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt(email, '1.1.1.1');
    }

    // IP berbeda untuk email yang sama — tidak boleh ikut kena limit,
    // ini yang mencegah satu user "mengunci" user lain lewat IP orang lain.
    await expect(service.assertNotRateLimited(email, '2.2.2.2')).resolves.toBeUndefined();
  });

  it('reset percobaan setelah login berhasil, sehingga counter kembali dari nol', async () => {
    const email = 'user@example.com';
    const ip = '127.0.0.1';

    for (let i = 0; i < 4; i++) {
      await service.recordFailedAttempt(email, ip);
    }
    await service.resetAttempts(email, ip);

    // Setelah reset, 4 percobaan gagal lagi seharusnya MASIH belum kena limit
    // (bukan langsung ke-5 dari sisa counter sebelumnya).
    for (let i = 0; i < 4; i++) {
      await service.recordFailedAttempt(email, ip);
    }
    await expect(service.assertNotRateLimited(email, ip)).resolves.toBeUndefined();
  });

  it('kunci case-insensitive terhadap email (Email@X.com vs email@x.com dianggap sama)', async () => {
    const ip = '127.0.0.1';
    for (let i = 0; i < 5; i++) {
      await service.recordFailedAttempt('User@Example.com', ip);
    }

    await expect(service.assertNotRateLimited('user@example.com', ip)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });
});
