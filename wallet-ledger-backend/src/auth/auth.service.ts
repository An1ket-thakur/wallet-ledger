import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserRole } from '../common/types/roles.enum';
import { User } from 'src/database/entities/users.entity';
import { RefreshToken } from 'src/database/entities/refresh-token.entity';
import { StringValue } from 'ms';

const REFRESH_TOKEN_TTL_DAYS = 30;

const ARGON2_OPTIONS: argon2.HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private users: Repository<User>,
    @InjectRepository(RefreshToken)
    private refreshTokens: Repository<RefreshToken>,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
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
        role: UserRole.CUSTOMER,
      }),
    );

    const session = await this.issueTokenPair(user.id, user.email, user.role);

    return {
      user: {
        email: user.email,
        fullName: user.fullName,
        id: user.id,
      },
      session,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.users.findOne({ where: { email: dto.email } });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.disabledAt) {
      throw new UnauthorizedException('Account disabled');
    }

    return this.issueTokenPair(user.id, user.email, user.role);
  }

  async rotateRefreshToken(
    userId: string,
    oldTokenId: string,
    email: string,
    role: UserRole,
  ) {
    await this.refreshTokens.update(
      { id: oldTokenId },
      { revokedAt: new Date() },
    );
    return this.issueTokenPair(userId, email, role);
  }

  async logout(tokenId: string) {
    await this.refreshTokens.update(
      { id: tokenId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { success: true };
  }

  async logoutAllSessions(userId: string) {
    await this.refreshTokens.update(
      { userId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
    return { success: true };
  }

  private async issueTokenPair(userId: string, email: string, role: UserRole) {
    const accessToken = this.jwt.sign(
      { sub: userId, email, role, type: 'access' },
      {
        secret: this.config.get<string>('JWT_ACCESS_SECRET') as StringValue,
        expiresIn: (this.config.get<string>('JWT_ACCESS_EXPIRY') ??
          '15m') as StringValue,
      },
    );

    const tokenId = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const tokenHash = await argon2.hash(secret, ARGON2_OPTIONS);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

    await this.refreshTokens.save(
      this.refreshTokens.create({ id: tokenId, userId, tokenHash, expiresAt }),
    );

    return {
      accessToken,
      refreshToken: `${tokenId}.${secret}`,
      expiresIn: this.config.get<string>('JWT_ACCESS_EXPIRY') ?? '15m',
    };
  }
}
