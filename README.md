# Platform Streaming Musik — Starter Monorepo

Struktur ini mengikuti arsitektur microservices yang sudah dirancang:
client (web/mobile) -> API gateway -> core services -> data layer.

## Struktur folder

```
streaming-musik/
├── apps/                    # Service berbasis NestJS (Node.js/TypeScript)
│   ├── auth-service/        # Login, JWT, manajemen sesi, reset password
│   ├── catalog-service/     # Metadata lagu, album, artis
│   ├── payment-service/     # Subscription & payment (Midtrans)
│   └── user-service/        # Playlist, library, riwayat dengar (belum diisi)
├── services/
│   └── media-service/       # Go — transcoding, streaming, integrasi CDN/DRM
├── gateway/                 # Konfigurasi API gateway (contoh: Kong/NGINX)
├── infra/                   # Docker Compose (lokal) + Terraform (AWS, nanti)
└── docker-compose.yml       # Menjalankan semua dependency lokal (Postgres, Redis, dst)
```

## Kenapa NestJS untuk sebagian besar service?

NestJS punya struktur modular bawaan (module/controller/service) yang cocok untuk tim
yang berkembang, dan ekosistemnya matang untuk hal seperti validasi request, guards
untuk auth, dan integrasi TypeORM/Prisma ke PostgreSQL.

## Kenapa Go untuk media-service?

Media service menangani transcoding dan streaming — beban I/O dan konkurensi tinggi.
Go punya goroutine yang ringan untuk menangani banyak koneksi streaming bersamaan,
dan performanya lebih dekat ke native dibanding Node.js untuk beban kerja seperti ini.

## Menjalankan secara lokal

```bash
docker compose up -d          # jalankan Postgres, Redis, Kafka, dll
cd apps/auth-service && npm install && npm run start:dev
cd apps/catalog-service && npm install && npm run start:dev
cd apps/payment-service && npm install && npm run start:dev
cd services/media-service && go mod tidy && go run cmd/main.go
```

Untuk coba alur lengkap login → cek subscription → streaming secara lokal:
1. `POST http://localhost:3001/auth/register` lalu `/auth/login` — simpan `accessToken`
2. `POST http://localhost:3003/subscriptions/checkout` dengan token di atas (header `Authorization: Bearer ...`) — di local dev tanpa `MIDTRANS_SERVER_KEY` asli, request ke Midtrans akan gagal; untuk testing gating saja, insert baris `subscriptions` manual ke Postgres dengan `status='active'` dan `current_period_end` di masa depan
3. `GET http://localhost:8080/tracks/:id/stream-url` dengan token yang sama — kalau subscription aktif, dapat signed URL; kalau tidak, ditolak 403

## Testing

`apps/auth-service`, `apps/catalog-service`, dan `apps/payment-service` sudah
punya automated test (Jest) — `payment-service` yang paling penting untuk
diperhatikan karena menyangkut logic uang sungguhan (checkout, webhook
idempotency, renewal). Karena sandbox pengembangan ini tidak selalu punya
akses internet untuk `npm install`, cara paling praktis untuk benar-benar
menjalankan test adalah lewat GitHub Actions: setiap push atau pull request
yang mengubah salah satu dari ketiga service ini otomatis menjalankan
test-nya masing-masing (lihat `.github/workflows/test-*.yml`).

Untuk jalankan lokal (kalau `npm install` bisa akses internet di mesinmu):
```bash
cd apps/auth-service && npm install && npm test
cd apps/catalog-service && npm install && npm test
cd apps/payment-service && npm install && npm test
```

## Langkah selanjutnya

1. Isi tiap service NestJS dengan module sesuai domainnya (lihat skema ERD).
2. Sambungkan `media-service` ke S3-compatible storage (lokal: MinIO, produksi: AWS S3).
3. Setup API gateway (Kong/NGINX) untuk routing ke tiap service + rate limiting.
4. Siapkan Terraform di `infra/` untuk provisioning AWS (RDS, ElastiCache, S3, CloudFront, MSK/Kafka).
