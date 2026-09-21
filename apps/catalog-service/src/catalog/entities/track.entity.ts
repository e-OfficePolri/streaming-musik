import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Album } from './album.entity';

@Entity('tracks')
export class Track {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column({ name: 'duration_sec' })
  durationSec: number;

  @Column({ name: 'isrc_code', nullable: true })
  isrcCode: string;

  @ManyToOne(() => Album, (album) => album.tracks)
  @JoinColumn({ name: 'album_id' })
  album: Album;
}
