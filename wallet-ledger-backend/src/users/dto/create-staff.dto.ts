import { IsEmail, IsEnum, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../common/types/roles.enum';

export class CreateStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters' })
  password!: string;

  @IsString()
  fullName!: string;

  // CUSTOMER is intentionally excluded - that's what /auth/register is for.
  @IsEnum([UserRole.SUPPORT, UserRole.ADMIN], {
    message: 'role must be one of: SUPPORT, ADMIN',
  })
  role!: UserRole.SUPPORT | UserRole.ADMIN;
}
