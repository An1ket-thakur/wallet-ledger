import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class WithdrawDto {
  @IsUUID()
  walletId!: string;

  @IsInt()
  @IsPositive()
  amount!: number;
}
