import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? 'streaming',
      password: process.env.DB_PASSWORD ?? 'streaming',
      database: process.env.DB_NAME ?? 'streaming_musik',
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'production', // matikan di produksi, pakai migration
    }),
    CatalogModule,
  ],
})
export class AppModule {}
