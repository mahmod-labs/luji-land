import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

// Client supplies the id (rule: client-generated UUIDs, decided this phase).
export class CreateChildDto {
  @IsUUID()
  id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;
}
