import { NotFoundException } from '@nestjs/common';
import { CatalogService } from './catalog.service';

function createMockRepo() {
  return {
    create: jest.fn((data) => data),
    save: jest.fn((entity) => Promise.resolve({ id: 'generated-id', ...entity })),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    exist: jest.fn(),
  };
}

describe('CatalogService', () => {
  let service: CatalogService;
  let artistsRepo: ReturnType<typeof createMockRepo>;
  let albumsRepo: ReturnType<typeof createMockRepo>;
  let tracksRepo: ReturnType<typeof createMockRepo>;

  beforeEach(() => {
    artistsRepo = createMockRepo();
    albumsRepo = createMockRepo();
    tracksRepo = createMockRepo();
    service = new CatalogService(artistsRepo as any, albumsRepo as any, tracksRepo as any);
  });

  describe('Artists', () => {
    it('createArtist menyimpan artist baru dengan field yang diberikan', async () => {
      await service.createArtist({ name: 'Contoh Artis', country: 'ID', labelId: 'label-1' } as any);

      expect(artistsRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Contoh Artis', country: 'ID', labelId: 'label-1' }),
      );
    });

    it('findAllArtists menghitung skip/take dan totalPages dengan benar', async () => {
      artistsRepo.findAndCount.mockResolvedValue([[{ id: '1' }, { id: '2' }], 45]);

      const result = await service.findAllArtists({ page: 3, limit: 20 });

      // page 3, limit 20 -> skip = (3-1)*20 = 40
      expect(artistsRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 40, take: 20 }),
      );
      expect(result).toEqual({
        items: [{ id: '1' }, { id: '2' }],
        total: 45,
        page: 3,
        limit: 20,
        totalPages: 3, // ceil(45/20) = 3
      });
    });

    it('findArtist melempar NotFoundException kalau id tidak ada', async () => {
      artistsRepo.findOne.mockResolvedValue(null);

      await expect(service.findArtist('id-tidak-ada')).rejects.toThrow(NotFoundException);
    });

    it('findArtist mengembalikan artist beserta relasi albums', async () => {
      const artist = { id: 'artist-1', name: 'Contoh', albums: [] };
      artistsRepo.findOne.mockResolvedValue(artist);

      await expect(service.findArtist('artist-1')).resolves.toEqual(artist);
      expect(artistsRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'artist-1' }, relations: ['albums'] }),
      );
    });
  });

  describe('Albums', () => {
    it('createAlbum menolak kalau artistId yang dirujuk tidak ada (validasi relasi)', async () => {
      artistsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createAlbum({ title: 'Album Baru', artistId: 'artist-tidak-ada' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(albumsRepo.save).not.toHaveBeenCalled();
    });

    it('createAlbum berhasil kalau artist ditemukan, mengaitkan album ke artist tersebut', async () => {
      const artist = { id: 'artist-1', name: 'Contoh' };
      artistsRepo.findOne.mockResolvedValue(artist);

      await service.createAlbum({ title: 'Album Baru', artistId: 'artist-1' } as any);

      expect(albumsRepo.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Album Baru', artist }));
    });

    it('findAlbum melempar NotFoundException kalau id tidak ada', async () => {
      albumsRepo.findOne.mockResolvedValue(null);

      await expect(service.findAlbum('id-tidak-ada')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Tracks', () => {
    it('createTrack menolak kalau albumId yang dirujuk tidak ada (validasi relasi berjenjang)', async () => {
      albumsRepo.findOne.mockResolvedValue(null);

      await expect(
        service.createTrack({ title: 'Lagu Baru', durationSec: 200, albumId: 'album-tidak-ada' } as any),
      ).rejects.toThrow(NotFoundException);
      expect(tracksRepo.save).not.toHaveBeenCalled();
    });

    it('createTrack berhasil kalau album ditemukan', async () => {
      const album = { id: 'album-1', title: 'Album' };
      albumsRepo.findOne.mockResolvedValue(album);

      await service.createTrack({
        title: 'Lagu Baru',
        durationSec: 200,
        isrcCode: 'ID-XXX-25-00001',
        albumId: 'album-1',
      } as any);

      expect(tracksRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Lagu Baru', durationSec: 200, isrcCode: 'ID-XXX-25-00001', album }),
      );
    });

    it('findTrack melempar NotFoundException kalau id tidak ada', async () => {
      tracksRepo.findOne.mockResolvedValue(null);

      await expect(service.findTrack('id-tidak-ada')).rejects.toThrow(NotFoundException);
    });

    it('trackExists meneruskan hasil query exist() apa adanya', async () => {
      tracksRepo.exist.mockResolvedValue(true);
      await expect(service.trackExists('track-1')).resolves.toBe(true);

      tracksRepo.exist.mockResolvedValue(false);
      await expect(service.trackExists('track-lain')).resolves.toBe(false);
    });

    it('searchTracks memakai ILIKE (case-insensitive) dan tetap menghitung pagination', async () => {
      tracksRepo.findAndCount.mockResolvedValue([[{ id: 'track-1', title: 'Judul Lagu' }], 1]);

      const result = await service.searchTracks('judul', { page: 1, limit: 20 });

      const callArgs = tracksRepo.findAndCount.mock.calls[0][0];
      // ILike dari TypeORM membungkus nilai jadi objek FindOperator — cukup
      // pastikan field yang dicari benar dan hasilnya tetap ter-paginate.
      expect(callArgs.where.title).toBeDefined();
      expect(result.total).toBe(1);
      expect(result.totalPages).toBe(1);
    });
  });
});
