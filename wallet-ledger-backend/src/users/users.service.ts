import { ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AuditService } from 'src/audit/audit.service';
import type { AuthenticatedUser } from 'src/common/decorators/current-user.decorator';
import { User } from 'src/database/entities/users.entity';
import { Repository } from 'typeorm';
import { CreateStaffDto } from './dto/create-staff.dto';
import * as argon2 from 'argon2';

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

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

  async createStaff(
    dto: CreateStaffDto,
    admin: AuthenticatedUser,
    ipAddress?: string | null,
  ) {
    const existing = await this.users.findOne({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);

    const user = await this.users.save(
      this.users.create({
        email: dto.email,
        fullName: dto.fullName,
        passwordHash,
        role: dto.role,
      }),
    );

    await this.audit.record({
      actorUserId: admin.id,
      actorRole: admin.role,
      action: 'STAFF_ACCOUNT_CREATED',
      targetType: 'user',
      targetId: user.id,
      details: { email: user.email, role: user.role },
      ipAddress,
    });

    return this.findById(user.id);
  }
}
