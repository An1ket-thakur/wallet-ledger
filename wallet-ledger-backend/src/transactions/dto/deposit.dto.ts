import { IsInt, IsPositive, IsUUID } from 'class-validator';

export class DepositDto {
  @IsUUID()
  walletId!: string;

  /** Minor units (cents). e.g. 1000 = $10.00. Sent as an integer, not a decimal. */
  @IsInt()
  @IsPositive()
  amount!: number;
}
