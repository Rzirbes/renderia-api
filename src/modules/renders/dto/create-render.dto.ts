import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { RenderPresetId } from '../render-presets';

const RENDER_PRESET_IDS = ['daylight_9am', 'blue_hour'] as const;

export class CreateRenderDto {
  @IsUrl()
  originalImageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @IsIn(RENDER_PRESET_IDS)
  presetId?: RenderPresetId;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  creditsToUse?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  clientRequestId?: string;
}
