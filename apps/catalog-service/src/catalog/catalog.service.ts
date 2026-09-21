import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Artist } from './entities/artist.entity';
import { Album } from './entities/album.entity';
import { Track } from './entities/track.entity';
import { CreateAlbumDto, CreateArtistDto, CreateTrackDto } from './dto/create-catalog.dto';
import { PaginationQueryDto } from './dto/query-catalog.dto';

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

@Injectable()
export class CatalogService {
  constructor(
    @InjectRepository(Artist) private artistsRepo: Repository<Artist>,
    @InjectRepository(Album) private albumsRepo: Repository<Album>,
    @InjectRepository(Track) private tracksRepo: Repository<Track>,
  ) {}

  // Artists
  createArtist(dto: CreateArtistDto) {
    const artist = this.artistsRepo.create({
      name: dto.name,
      country: dto.country,
      labelId: dto.labelId,
    });
    return this.artistsRepo.save(artist);
  }

  async findAllArtists(pagination: PaginationQueryDto): Promise<PaginatedResult<Artist>> {
    const { page, limit } = pagination;
    const [items, total] = await this.artistsRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { name: 'ASC' },
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findArtist(id: string) {
    const artist = await this.artistsRepo.findOne({ where: { id }, relations: ['albums'] });
    if (!artist) throw new NotFoundException(`Artist ${id} tidak ditemukan`);
    return artist;
  }

  // Albums
  async createAlbum(dto: CreateAlbumDto) {
    const artist = await this.findArtist(dto.artistId);
    const album = this.albumsRepo.create({
      title: dto.title,
      releaseDate: dto.releaseDate,
      artist,
    });
    return this.albumsRepo.save(album);
  }

  async findAllAlbums(pagination: PaginationQueryDto): Promise<PaginatedResult<Album>> {
    const { page, limit } = pagination;
    const [items, total] = await this.albumsRepo.findAndCount({
      relations: ['artist'],
      skip: (page - 1) * limit,
      take: limit,
      order: { title: 'ASC' },
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findAlbum(id: string) {
    const album = await this.albumsRepo.findOne({ where: { id }, relations: ['artist', 'tracks'] });
    if (!album) throw new NotFoundException(`Album ${id} tidak ditemukan`);
    return album;
  }

  // Tracks
  async createTrack(dto: CreateTrackDto) {
    const album = await this.findAlbum(dto.albumId);
    const track = this.tracksRepo.create({
      title: dto.title,
      durationSec: dto.durationSec,
      isrcCode: dto.isrcCode,
      album,
    });
    return this.tracksRepo.save(track);
  }

  async findAllTracks(pagination: PaginationQueryDto): Promise<PaginatedResult<Track>> {
    const { page, limit } = pagination;
    const [items, total] = await this.tracksRepo.findAndCount({
      relations: ['album'],
      skip: (page - 1) * limit,
      take: limit,
      order: { title: 'ASC' },
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // Pencarian sederhana berbasis ILIKE di Postgres — cukup untuk MVP.
  // Saat katalog membesar (jutaan track) atau butuh fitur seperti typo-tolerance
  // dan ranking relevansi, pindahkan ke Meilisearch/Elasticsearch: service ini
  // tinggal mengindeks ulang setiap kali track dibuat/diubah, dan endpoint di
  // bawah diarahkan ke search engine tersebut alih-alih query Postgres langsung.
  async searchTracks(query: string, pagination: PaginationQueryDto): Promise<PaginatedResult<Track>> {
    const { page, limit } = pagination;
    const [items, total] = await this.tracksRepo.findAndCount({
      where: { title: ILike(`%${query}%`) },
      relations: ['album'],
      skip: (page - 1) * limit,
      take: limit,
      order: { title: 'ASC' },
    });
    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findTrack(id: string) {
    const track = await this.tracksRepo.findOne({ where: { id }, relations: ['album'] });
    if (!track) throw new NotFoundException(`Track ${id} tidak ditemukan`);
    return track;
  }

  // Dipakai service lain (misal media-service) untuk validasi cepat sebelum streaming
  async trackExists(id: string) {
    return this.tracksRepo.exist({ where: { id } });
  }
}
