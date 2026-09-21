import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { LoginRateLimitService } from '../common/login-rate-limit.service';
import { EmailService } from '../common/email.service';
import { TokenBlocklistService } from '../common/token-blocklist.service';

// Mock berbentuk objek biasa, bukan @nestjs/testing TestingModule — lebih
// cepat dijalankan dan cukup untuk unit test murni logic AuthService, tanpa
// perlu bootstrap DI container penuh.
function createMockRepo() {
  return {
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: 'generated-id', ...entity })),
    delete: jest.fn(),
    remove: jest.fn(),
  };
}

describe('AuthService', () => {
  let service: AuthService;
  let usersRepo: ReturnType<typeof createMockRepo>;
  let resetTokensRepo: ReturnType<typeof createMockRepo>;
  let devicesRepo: ReturnType<typeof createMockRepo>;
  let jwtService: Partial<JwtService>;
  let rateLimitService: Partial<LoginRateLimitService>;
  let emailService: Partial<EmailService>;
  let blocklistService: Partial<TokenBlocklistService>;

  beforeEach(() => {
    usersRepo = createMockRepo();
    resetTokensRepo = createMockRepo();
    devicesRepo = createMockRepo();
    jwtService = { sign: jest.fn().mockReturnValue('fake.jwt.token') };
    rateLimitService = {
      assertNotRateLimited: jest.fn().mockResolvedValue(undefined),
      recordFailedAttempt: jest.fn().mockResolvedValue(undefined),
      resetAttempts: jest.fn().mockResolvedValue(undefined),
    };
    emailService = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
    blocklistService = { revoke: jest.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      usersRepo as any,
      resetTokensRepo as any,
      devicesRepo as any,
      jwtService as JwtService,
      rateLimitService as LoginRateLimitService,
      emailService as EmailService,
      blocklistService as TokenBlocklistService,
    );
  });

  describe('register', () => {
    it('menolak dengan ConflictException kalau email sudah terdaftar', async () => {
      usersRepo.findOneBy.mockResolvedValue({ id: 'existing-user', email: 'ada@example.com' });

      await expect(service.register('ada@example.com', 'password123')).rejects.toThrow(ConflictException);
      expect(usersRepo.save).not.toHaveBeenCalled();
    });

    it('membuat user baru dengan password ter-hash, bukan plain text', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);

      await service.register('baru@example.com', 'password123');

      expect(usersRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'baru@example.com',
          passwordHash: expect.not.stringMatching('password123'),
        }),
      );
    });
  });

  describe('login', () => {
    const validUser = {
      id: 'user-1',
      email: 'user@example.com',
      // Hash bcrypt dengan format VALID (53 karakter setelah $2b$10$) tapi
      // bukan hash sungguhan dari string apa pun — cukup untuk memastikan
      // bcrypt.compare() tidak melempar error karena format salah, dan akan
      // selalu mengembalikan false untuk password apa pun yang dites di sini.
      passwordHash: '$2b$10$C3q6z2s5nqfE1r6kK3O2FeXK5b8h9m0nWY0kM5s6dJ6y1lR0O0K0G',
    };

    it('menolak dengan pesan GENERIK saat email tidak ditemukan (mencegah user enumeration)', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);

      await expect(service.login('tidak-ada@example.com', 'apapun', '127.0.0.1')).rejects.toThrow(
        'Email atau password salah',
      );
      expect(rateLimitService.recordFailedAttempt).toHaveBeenCalledWith('tidak-ada@example.com', '127.0.0.1');
    });

    it('menolak dengan pesan yang SAMA PERSIS saat password salah (bukan pesan berbeda)', async () => {
      usersRepo.findOneBy.mockResolvedValue(validUser);

      await expect(service.login(validUser.email, 'password-salah', '127.0.0.1')).rejects.toThrow(
        'Email atau password salah',
      );
    });

    it('memeriksa rate limit SEBELUM query database', async () => {
      const error = new Error('rate limited');
      (rateLimitService.assertNotRateLimited as jest.Mock).mockRejectedValue(error);

      await expect(service.login('user@example.com', 'x', '127.0.0.1')).rejects.toThrow(error);
      expect(usersRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('reset rate limit counter setelah login berhasil', async () => {
      usersRepo.findOneBy.mockResolvedValue(validUser);
      jest.spyOn(require('bcrypt'), 'compare').mockResolvedValueOnce(true as never);

      await service.login(validUser.email, 'password-benar', '127.0.0.1');

      expect(rateLimitService.resetAttempts).toHaveBeenCalledWith(validUser.email, '127.0.0.1');
    });

    it('mencatat Device baru dengan jti unik setiap kali login berhasil', async () => {
      usersRepo.findOneBy.mockResolvedValue(validUser);
      jest.spyOn(require('bcrypt'), 'compare').mockResolvedValueOnce(true as never);

      await service.login(validUser.email, 'password-benar', '127.0.0.1', 'iPhone 15');

      expect(devicesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ deviceName: 'iPhone 15', tokenJti: expect.any(String) }),
      );
    });

    it('pakai nama device default kalau deviceName tidak dikirim', async () => {
      usersRepo.findOneBy.mockResolvedValue(validUser);
      jest.spyOn(require('bcrypt'), 'compare').mockResolvedValueOnce(true as never);

      await service.login(validUser.email, 'password-benar', '127.0.0.1');

      expect(devicesRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ deviceName: 'Perangkat tidak dikenal' }),
      );
    });
  });

  describe('requestPasswordReset', () => {
    it('tidak melempar error dan tidak kirim email kalau user tidak ditemukan (anti user enumeration)', async () => {
      usersRepo.findOneBy.mockResolvedValue(null);

      await expect(service.requestPasswordReset('tidak-ada@example.com')).resolves.toBeUndefined();
      expect(emailService.sendPasswordResetEmail).not.toHaveBeenCalled();
      expect(resetTokensRepo.save).not.toHaveBeenCalled();
    });

    it('membuat token reset dan mengirim email kalau user ditemukan', async () => {
      const user = { id: 'user-1', email: 'user@example.com' };
      usersRepo.findOneBy.mockResolvedValue(user);

      await service.requestPasswordReset(user.email);

      expect(resetTokensRepo.save).toHaveBeenCalled();
      expect(emailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        user.email,
        expect.stringContaining('/reset-password?token='),
      );
    });

    it('TIDAK PERNAH menyimpan token mentah — hanya hash-nya', async () => {
      const user = { id: 'user-1', email: 'user@example.com' };
      usersRepo.findOneBy.mockResolvedValue(user);

      await service.requestPasswordReset(user.email);

      const savedArg = resetTokensRepo.save.mock.calls[0][0];
      const emailLinkArg = (emailService.sendPasswordResetEmail as jest.Mock).mock.calls[0][1] as string;
      const rawTokenInLink = new URL(emailLinkArg).searchParams.get('token');

      // Hash yang disimpan HARUS BEDA dari raw token yang dikirim ke email —
      // kalau sama, berarti kita menyimpan token mentah (celah keamanan).
      expect(savedArg.tokenHash).not.toEqual(rawTokenInLink);
    });
  });

  describe('resetPassword', () => {
    it('menolak token yang tidak ditemukan', async () => {
      resetTokensRepo.findOne.mockResolvedValue(null);

      await expect(service.resetPassword('token-asal', 'passwordBaru123')).rejects.toThrow(UnauthorizedException);
    });

    it('menolak token yang sudah pernah dipakai (usedAt terisi)', async () => {
      resetTokensRepo.findOne.mockResolvedValue({
        tokenHash: 'hash',
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 100000),
        user: { id: 'user-1' },
      });

      await expect(service.resetPassword('token-asal', 'passwordBaru123')).rejects.toThrow(UnauthorizedException);
    });

    it('menolak token yang sudah kedaluwarsa', async () => {
      resetTokensRepo.findOne.mockResolvedValue({
        tokenHash: 'hash',
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000), // 1 detik yang lalu
        user: { id: 'user-1' },
      });

      await expect(service.resetPassword('token-asal', 'passwordBaru123')).rejects.toThrow(UnauthorizedException);
    });

    it('berhasil reset, menandai token used, DAN mencabut semua device aktif', async () => {
      const user = { id: 'user-1', email: 'user@example.com', passwordHash: 'hash-lama' };
      const resetToken = {
        tokenHash: 'hash',
        usedAt: null,
        expiresAt: new Date(Date.now() + 100000),
        user,
      };
      resetTokensRepo.findOne.mockResolvedValue(resetToken);
      devicesRepo.find.mockResolvedValue([
        { id: 'device-1', tokenJti: 'jti-1', tokenExpiresAt: new Date(Date.now() + 100000) },
      ]);

      await service.resetPassword('token-asal', 'passwordBaru123');

      // Password berubah
      expect(usersRepo.save).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: expect.any(String) }));
      // Token ditandai sudah dipakai
      expect(resetTokensRepo.save).toHaveBeenCalledWith(expect.objectContaining({ usedAt: expect.any(Date) }));
      // SEMUA device di-revoke — ini yang menutup celah akses attacker
      expect(blocklistService.revoke).toHaveBeenCalledWith('jti-1', expect.any(Number));
      expect(devicesRepo.remove).toHaveBeenCalled();
    });
  });

  describe('manajemen device', () => {
    it('logoutDevice bersifat idempotent — device tidak ditemukan tidak melempar error', async () => {
      devicesRepo.findOne.mockResolvedValue(null);

      await expect(service.logoutDevice('user-1', 'device-tidak-ada')).resolves.toBeUndefined();
      expect(blocklistService.revoke).not.toHaveBeenCalled();
    });

    it('logoutDevice mencabut token dan menghapus baris device', async () => {
      const device = { id: 'device-1', tokenJti: 'jti-1', tokenExpiresAt: new Date(Date.now() + 100000) };
      devicesRepo.findOne.mockResolvedValue(device);

      await service.logoutDevice('user-1', 'device-1');

      expect(blocklistService.revoke).toHaveBeenCalledWith('jti-1', expect.any(Number));
      expect(devicesRepo.delete).toHaveBeenCalledWith('device-1');
    });

    it('logoutOtherDevices TIDAK mencabut device dengan jti yang sedang dipakai saat ini', async () => {
      const currentDevice = { id: 'device-current', tokenJti: 'jti-current', tokenExpiresAt: new Date(Date.now() + 100000) };
      const otherDevice = { id: 'device-other', tokenJti: 'jti-other', tokenExpiresAt: new Date(Date.now() + 100000) };
      devicesRepo.find.mockResolvedValue([currentDevice, otherDevice]);

      await service.logoutOtherDevices('user-1', 'jti-current');

      expect(blocklistService.revoke).toHaveBeenCalledTimes(1);
      expect(blocklistService.revoke).toHaveBeenCalledWith('jti-other', expect.any(Number));
      expect(devicesRepo.remove).toHaveBeenCalledWith([otherDevice]);
    });
  });
});
