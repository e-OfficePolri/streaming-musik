import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { Album } from './album.entity';

@Entity('artists')
export class Artist {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  country: string;

  @Column({ nullable: true, name: 'label_id' })
  labelId: string;

  @OneToMany(() => Album, (album) => album.artist)
  albums: Album[];
}
