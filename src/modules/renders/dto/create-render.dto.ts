import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const RENDER_PRESET_IDS = [
  'daylight_9am',
  'blue_hour',
  'exterior_daylight_locked',
] as const;

export class CreateRenderDto {
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  prompt?: string;

  @IsOptional()
  @IsIn(RENDER_PRESET_IDS)
  presetId?: (typeof RENDER_PRESET_IDS)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  creditsToUse?: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  clientRequestId?: string;

  @IsString()
  @MaxLength(512)
  originalImagePath!: string;

  @IsString()
  @MaxLength(128)
  originalImageMimeType!: string;

  @IsString()
  @MaxLength(512)
  originalImageUrl!: string;
}
