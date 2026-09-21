import { Column, Entity, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Artist } from './artist.entity';
import { Track } from './track.entity';

@Entity('albums')
export class Album {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ type: 'date', nullable: true, name: 'release_date' })
  releaseDate: string;

  @ManyToOne(() => Artist, (artist) => artist.albums)
  @JoinColumn({ name: 'artist_id' })
  artist: Artist;

  @OneToMany(() => Track, (track) => track.album)
  tracks: Track[];
}
