import { IsIn, IsInt, IsPositive, IsString, IsUUID } from 'class-validator';

export class PaymentWebhookDto {
  @IsString()
  eventId!: string;

  @IsIn(['payment.succeeded'])
  type!: 'payment.succeeded';

  @IsUUID()
  walletId!: string;

  /** Minor units (cents). */
  @IsInt()
  @IsPositive()
  amount!: number;

  @IsString()
  currency!: string;
}
