import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CreateAlbumDto, CreateArtistDto, CreateTrackDto } from './dto/create-catalog.dto';
import { PaginationQueryDto, SearchTracksQueryDto } from './dto/query-catalog.dto';

@Controller('artists')
export class ArtistsController {
  constructor(private catalogService: CatalogService) {}

  @Post()
  create(@Body() dto: CreateArtistDto) {
    return this.catalogService.createArtist(dto);
  }

  @Get()
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.catalogService.findAllArtists(pagination);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalogService.findArtist(id);
  }
}

@Controller('albums')
export class AlbumsController {
  constructor(private catalogService: CatalogService) {}

  @Post()
  create(@Body() dto: CreateAlbumDto) {
    return this.catalogService.createAlbum(dto);
  }

  @Get()
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.catalogService.findAllAlbums(pagination);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalogService.findAlbum(id);
  }
}

@Controller('tracks')
export class TracksController {
  constructor(private catalogService: CatalogService) {}

  @Post()
  create(@Body() dto: CreateTrackDto) {
    return this.catalogService.createTrack(dto);
  }

  @Get()
  findAll(@Query() pagination: PaginationQueryDto) {
    return this.catalogService.findAllTracks(pagination);
  }

  // Harus dideklarasikan sebelum @Get(':id') — kalau tidak, "search" akan
  // tertangkap sebagai nilai parameter :id alih-alih route terpisah.
  @Get('search')
  search(@Query() query: SearchTracksQueryDto) {
    const { q, ...pagination } = query;
    return this.catalogService.searchTracks(q, pagination);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.catalogService.findTrack(id);
  }
}
