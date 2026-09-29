import {
  IsEmail,
  IsString,
  MinLength,
  IsOptional,
  IsEnum,
} from 'class-validator';
import { UserRole } from 'src/common/types/roles.enum';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  password!: string;

  @IsString()
  fullName!: string;

  // In production this should never be client-settable for anything above CUSTOMER;
  // enforce that in the service, not just the DTO.
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
