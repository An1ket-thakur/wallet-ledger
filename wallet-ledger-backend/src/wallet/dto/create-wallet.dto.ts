import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/constants/currencies';

export class CreateWalletDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  label?: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsIn([...SUPPORTED_CURRENCIES], {
    message: `currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
  })
  currency!: string;
}
