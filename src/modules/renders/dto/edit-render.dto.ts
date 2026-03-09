import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const RENDER_PRESET_IDS = ['daylight_9am', 'blue_hour'] as const;

export class EditRenderDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @IsIn(RENDER_PRESET_IDS)
  presetId?: (typeof RENDER_PRESET_IDS)[number];
}
