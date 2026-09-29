import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from 'src/database/entities/users.entity';
import { Repository } from 'typeorm';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private users: Repository<User>) {}

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

  async setDisabled(id: string, disabled: boolean) {
    await this.users.update(
      { id },
      { disabledAt: disabled ? new Date() : null },
    );
    return this.findById(id);
  }
}
