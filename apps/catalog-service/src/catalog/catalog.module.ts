import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Artist } from './entities/artist.entity';
import { Album } from './entities/album.entity';
import { Track } from './entities/track.entity';
import { CatalogService } from './catalog.service';
import { ArtistsController, AlbumsController, TracksController } from './catalog.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Artist, Album, Track])],
  controllers: [ArtistsController, AlbumsController, TracksController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
