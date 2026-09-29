import { Body, Controller, Post, UseInterceptors } from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { TransactionsService } from './transactions.service';
import { DepositDto } from './dto/deposit.dto';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { TransferDto } from './dto/transfer.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @UseInterceptors(IdempotencyInterceptor)
  @Post('deposit')
  deposit(@CurrentUser() user: AuthenticatedUser, @Body() dto: DepositDto) {
    return this.transactionsService.deposit(user, dto);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('transfer')
  transfer(@CurrentUser() user: AuthenticatedUser, @Body() dto: TransferDto) {
    return this.transactionsService.transfer(user, dto);
  }
}
