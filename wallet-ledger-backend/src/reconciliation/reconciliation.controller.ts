import {
  Controller,
  Get,
  Post,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
  Req,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import { ReconciliationService } from './reconciliation.service';
import { ReconciliationRun } from 'src/database/entities/reconciliation-run.entity';
import { AuditService } from 'src/audit/audit.service';
import {
  type AuthenticatedUser,
  CurrentUser,
} from 'src/common/decorators/current-user.decorator';
import type { Request } from 'express';

export interface ReconciliationRunResponse {
  id: string;
  status: string;
  totalDebits: string;
  totalCredits: string;
  unbalancedTransactionCount: number;
  details: Record<string, unknown> | null;
  triggeredBy: string;
  durationMs: number;
  createdAt: Date;
}

// BigInt fields (totalDebits/totalCredits) can't be JSON-serialized directly -
// Nest's default serializer throws "Do not know how to serialize a BigInt".
// Always convert through this before returning an entity from a controller.
function toResponse(run: ReconciliationRun): ReconciliationRunResponse {
  return {
    id: run.id,
    status: run.status,
    totalDebits: run.totalDebits.toString(),
    totalCredits: run.totalCredits.toString(),
    unbalancedTransactionCount: run.unbalancedTransactionCount,
    details: run.details,
    triggeredBy: run.triggeredBy,
    durationMs: run.durationMs,
    createdAt: run.createdAt,
  };
}

// Support/Admin only - this exposes internal ledger-health data, not
// something a customer has any reason to see.
@Roles(UserRole.SUPPORT, UserRole.ADMIN)
@Controller('reconciliation')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly audit: AuditService,
  ) {}

  // Lets an admin re-run the check on demand (e.g. right after investigating
  // a reported discrepancy) instead of waiting for 2am.
  @Roles(UserRole.ADMIN)
  @Post('run')
  async run(
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<ReconciliationRunResponse> {
    const run = await this.reconciliation.runCheck('MANUAL');
    await this.audit.record({
      actorUserId: admin.id,
      actorRole: admin.role,
      action: 'RECONCILIATION_MANUAL_RUN',
      targetType: 'reconciliation_run',
      targetId: run.id,
      details: {
        status: run.status,
        unbalancedTransactionCount: run.unbalancedTransactionCount,
      },
      ipAddress: req.ip,
    });
    return toResponse(run);
  }

  @Get('runs')
  async listRuns(
    @Query('limit', new DefaultValuePipe(30), ParseIntPipe) limit: number,
  ): Promise<ReconciliationRunResponse[]> {
    const runs = await this.reconciliation.listRuns(limit);
    return runs.map(toResponse);
  }
}
