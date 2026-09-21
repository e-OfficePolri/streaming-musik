# Terraform — Infrastruktur AWS

Resource yang dibuat:

| File | Isi |
|---|---|
| `vpc.tf` | VPC, subnet publik/privat, NAT gateway |
| `rds.tf` | PostgreSQL (RDS) di subnet privat |
| `redis.tf` | Redis (ElastiCache) di subnet privat |
| `s3_cdn.tf` | Bucket audio (privat) + CloudFront dengan signed URL |
| `ecs.tf` | ECS Fargate cluster, ALB, task definition + service untuk auth-service, catalog-service, media-service, ECR repo untuk tiap service |
| `oidc.tf` | OIDC provider + IAM role untuk GitHub Actions (CI/CD tanpa access key jangka panjang) |
| `service-discovery.tf` | AWS Cloud Map — DNS internal untuk panggilan service-to-service (media-service memanggil payment-service) |

## Sebelum menjalankan

1. Buat bucket S3 untuk menyimpan Terraform state (sekali saja, manual):
   ```bash
   aws s3api create-bucket --bucket streaming-musik-terraform-state --region ap-southeast-1
   ```
   Lalu update nama bucket ini di `providers.tf`.

2. Generate keypair untuk signed URL CloudFront:
   ```bash
   openssl genrsa -out private_key.pem 2048
   openssl rsa -pubout -in private_key.pem -out cloudfront_public_key.pem
   ```
   Simpan `private_key.pem` di AWS Secrets Manager (JANGAN commit ke git) —
   ini yang dipakai `media-service` untuk generate signed URL.
   `cloudfront_public_key.pem` harus ada di folder ini saat `terraform apply`.

3. Salin `terraform.tfvars.example` jadi `terraform.tfvars` dan isi `db_password` dan `github_repo`.

## CI/CD (GitHub Actions)

Setelah `terraform apply`, ambil output `github_actions_role_arn`:
```bash
terraform output github_actions_role_arn
```
Lalu tambahkan sebagai secret `AWS_ROLE_ARN` di GitHub repo (Settings →
Secrets and variables → Actions). Setelah itu, setiap push ke `main` yang
mengubah folder `apps/auth-service/`, `apps/catalog-service/`, atau
`services/media-service/` otomatis build image, push ke ECR, dan deploy
ke ECS — lihat `.github/workflows/`.

## Menjalankan

```bash
terraform init
terraform plan
terraform apply
```

## Catatan penting

- **Task definition sudah lengkap untuk ketiga service** (auth, catalog,
  media). `media-service` punya task role terpisah dengan izin S3 dan
  Secrets Manager, karena dia yang perlu baca/tulis file audio dan
  private key signing CloudFront — service lain tidak butuh izin ini.
- **Password DB dan JWT secret** sengaja tidak langsung ditulis di environment
  container. Untuk produksi nyata, pakai blok `secrets` di task definition
  yang mengambil nilai dari AWS Secrets Manager — jangan taruh credential
  dalam bentuk plain text di mana pun dalam kode Terraform.
- Setup ini pakai **single NAT gateway** untuk hemat biaya di tahap awal.
  Untuk produksi dengan high-availability penuh, buat satu NAT gateway per AZ.
- `db_instance_class` dan `redis_node_type` default-nya instance kecil
  (cukup untuk dev/MVP) — naikkan ukurannya seiring traffic bertambah.
