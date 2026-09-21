import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateArtistDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsUUID()
  labelId?: string;
}

export class CreateAlbumDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  releaseDate?: string;

  @IsUUID()
  artistId: string;
}

export class CreateTrackDto {
  @IsString()
  title: string;

  @IsInt()
  @Min(1)
  durationSec: number;

  @IsOptional()
  @IsString()
  isrcCode?: string;

  @IsUUID()
  albumId: string;
}
