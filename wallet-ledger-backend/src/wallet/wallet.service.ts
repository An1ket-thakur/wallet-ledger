import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from '../database/entities/wallet.entity';
import { WalletStatus } from '../common/types/ledger.enum';
import { UserRole } from '../common/types/roles.enum';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { LedgerService } from '../ledger/ledger.service';
import { CreateWalletDto } from './dto/create-wallet.dto';

export interface WalletResponse {
  id: string;
  currency: string;
  status: WalletStatus;
  createdAt: Date;
  label: string;
}

export interface WalletBalanceResponse {
  walletId: string;
  currency: string;
  label: string;
  /** Minor units (cents) as a string - BigInt can't be JSON-serialized. */
  balance: string;
}

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly ledger: LedgerService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateWalletDto,
  ): Promise<WalletResponse> {
    const wallet = await this.wallets.save(
      this.wallets.create({
        userId: user.id,
        systemCode: null,
        currency: dto.currency,
        label: dto.label,
        status: WalletStatus.ACTIVE,
      }),
    );
    return this.toResponse(wallet);
  }

  async listMine(user: AuthenticatedUser): Promise<WalletResponse[]> {
    const rows = await this.wallets.find({
      where: { userId: user.id },
      order: { createdAt: 'ASC' },
    });
    return rows.map((w) => this.toResponse(w));
  }

  async getOne(
    user: AuthenticatedUser,
    walletId: string,
  ): Promise<WalletResponse> {
    return this.toResponse(await this.findAccessible(user, walletId));
  }

  async getBalance(
    user: AuthenticatedUser,
    walletId: string,
  ): Promise<WalletBalanceResponse> {
    const wallet = await this.findAccessible(user, walletId);
    const balance = await this.ledger.getBalance(wallet.id);
    return {
      walletId: wallet.id,
      currency: wallet.currency,
      label: wallet.label || '',
      balance: balance.toString(),
    };
  }

  /**
   * Customers can only see their own wallets; Support/Admin can see any.
   * A customer asking for someone else's wallet gets 404, not 403, so wallet
   * ids can't be probed for existence.
   */
  private async findAccessible(
    user: AuthenticatedUser,
    walletId: string,
  ): Promise<Wallet> {
    const wallet = await this.wallets.findOne({ where: { id: walletId } });
    const isStaff = ([UserRole.SUPPORT, UserRole.ADMIN] as string[]).includes(
      user.role,
    );

    if (!wallet || (!isStaff && wallet.userId !== user.id)) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  private toResponse(w: Wallet): WalletResponse {
    return {
      id: w.id,
      currency: w.currency,
      status: w.status,
      createdAt: w.createdAt,
      label: w.label || '',
    };
  }
}
