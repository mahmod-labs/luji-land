import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// Client supplies the id (client-generated UUIDs, decided this phase).
export class CreateStaffDto {
  @IsUUID()
  id = '';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName = '';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName = '';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  role = '';
}
