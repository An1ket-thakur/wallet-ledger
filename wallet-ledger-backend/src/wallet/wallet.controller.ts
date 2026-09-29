import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
} from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { WalletsService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { IdempotencyInterceptor } from 'src/idempotency/idempotency.interceptor';

// All routes require a valid access token (global JwtAuthGuard).
// Ownership/role checks live in WalletsService.findAccessible().
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @UseInterceptors(IdempotencyInterceptor)
  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWalletDto) {
    return this.walletsService.create(user, dto);
  }

  @Get()
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.walletsService.listMine(user);
  }

  @Get(':id')
  getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.walletsService.getOne(user, id);
  }

  @Get(':id/balance')
  getBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.walletsService.getBalance(user, id);
  }
}
