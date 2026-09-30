import {
  Controller,
  Get,
  Post,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import { ReconciliationService } from './reconciliation.service';

// Support/Admin only - this exposes internal ledger-health data, not
// something a customer has any reason to see.
@Roles(UserRole.SUPPORT, UserRole.ADMIN)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(private readonly reconciliation: ReconciliationService) {}

  // Lets an admin re-run the check on demand (e.g. right after investigating
  // a reported discrepancy) instead of waiting for 2am.
  @Roles(UserRole.ADMIN)
  @Post('run')
  run() {
    return this.reconciliation.runCheck('MANUAL');
  }

  @Get('runs')
  listRuns(
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ) {
    return this.reconciliation.listRuns(limit);
  }
}
