import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditService } from 'src/audit/audit.service';
import type { AuthenticatedUser } from 'src/common/decorators/current-user.decorator';
import { User } from 'src/database/entities/users.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  findById(id: string) {
    return this.users.findOne({
      where: { id },
      select: { email: true, id: true },
    });
  }

  // Support/Admin read-only listing. Never returns passwordHash.
  findAll() {
    return this.users.find({
      select: {
        id: true,
        email: true,
        role: true,
        disabledAt: true,
        createdAt: true,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async setDisabled(
    id: string,
    disabled: boolean,
    admin: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    await this.users.update(
      { id },
      { disabledAt: disabled ? new Date() : null },
    );

    await this.audit.record({
      actorUserId: admin.id,
      actorRole: admin.role,
      action: disabled ? 'USER_DISABLED' : 'USER_ENABLED',
      targetType: 'user',
      targetId: id,
      ipAddress,
    });

    return this.findById(id);
  }
}
