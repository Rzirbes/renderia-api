import {
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateRenderDto {
  @IsUrl()
  originalImageUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  prompt?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  creditsToUse?: number;
}
