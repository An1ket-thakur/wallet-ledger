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

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
