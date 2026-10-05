import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-custom';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import type { Request } from 'express';
import { User } from 'src/database/entities/users.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokens: Repository<RefreshToken>,
  ) {
    super();
  }

  async validate(req: Request) {
    const raw: string | undefined = req.body?.refreshToken;
    if (!raw || !raw.includes('.')) {
      throw new UnauthorizedException('Malformed refresh token');
    }

    const [tokenId, secret] = raw.split('.');

    const record = await this.refreshTokens.findOne({ where: { id: tokenId } });
    if (!record || record.revokedAt || record.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token invalid or expired');
    }

    const matches = await argon2.verify(record.tokenHash, secret);
    if (!matches) {
      await this.refreshTokens.update(
        { userId: record.userId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException(
        'Refresh token reuse detected; all sessions revoked',
      );
    }

    const user = await this.users.findOne({ where: { id: record.userId } });
    if (!user || user.disabledAt) {
      throw new UnauthorizedException('Account no longer active');
    }

    return { user, tokenRecord: record };
  }
}
