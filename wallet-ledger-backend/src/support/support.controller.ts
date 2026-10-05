import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import { SupportService } from './support.service';

@Roles(UserRole.SUPPORT, UserRole.ADMIN)
@Controller('support')
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('users/:userId')
  getUser(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.supportService.findUser(userId);
  }

  @Get('users/:userId/wallets')
  listUserWallets(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.supportService.listWalletsForUser(userId);
  }

  @Get('wallets/:walletId/history')
  getWalletHistory(
    @Param('walletId', ParseUUIDPipe) walletId: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.supportService.getWalletHistory(walletId, limit);
  }

  @Get('transactions/:transactionId')
  getTransactionDetail(
    @Param('transactionId', ParseUUIDPipe) transactionId: string,
  ) {
    return this.supportService.getTransactionDetail(transactionId);
  }
}
