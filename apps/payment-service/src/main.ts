import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.getHttpAdapter().getInstance().set('trust proxy', true);
  await app.listen(process.env.PORT ?? 3003);
  console.log(`Payment service berjalan di port ${process.env.PORT ?? 3003}`);
}
bootstrap();
