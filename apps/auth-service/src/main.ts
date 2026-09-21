import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Wajib di belakang ALB (lihat infra/terraform/ecs.tf) — tanpa ini,
  // @Ip() akan selalu membaca IP internal load balancer, bukan IP klien
  // asli, sehingga rate limiting per-IP jadi tidak berarti (semua request
  // dianggap dari IP yang sama).
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  await app.listen(process.env.PORT ?? 3001);
  console.log(`Auth service berjalan di port ${process.env.PORT ?? 3001}`);
}
bootstrap();
