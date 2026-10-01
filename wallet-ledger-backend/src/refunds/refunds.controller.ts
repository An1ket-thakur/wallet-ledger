import { Body, Controller, Post, Req, UseInterceptors } from '@nestjs/common';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import { IdempotencyInterceptor } from '../idempotency/idempotency.interceptor';
import { RefundsService } from './refunds.service';
import { CreateRefundDto } from './dto/create-refund.dto';
import type { Request } from 'express';

@Controller('refunds')
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  // Admin-only: refunds/reversals are a privileged correction path, not
  // something a customer or support agent can trigger directly.
  @Roles(UserRole.ADMIN)
  @UseInterceptors(IdempotencyInterceptor)
  @Post()
  reverse(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateRefundDto,
    @Req() req: Request,
  ) {
    return this.refundsService.reverse(admin, dto, req.ip);
  }
}
