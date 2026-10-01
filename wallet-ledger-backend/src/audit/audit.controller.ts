import {
  Controller,
  Get,
  Query,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import { Roles } from '../common/decorators/roles.decorator';
import { UserRole } from '../common/types/roles.enum';
import { AuditService } from './audit.service';

// Admin-only: the audit log itself is sensitive (who did what to whom), so
// even Support doesn't get read access here - only Admin.
@Roles(UserRole.ADMIN)
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('actions')
  listRecent(
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.auditService.listRecent(limit);
  }
}
