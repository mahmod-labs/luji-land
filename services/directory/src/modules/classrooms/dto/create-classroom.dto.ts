import { IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

// Client supplies the id (client-generated UUIDs, decided this phase).
export class CreateClassroomDto {
  @IsUUID()
  id = '';

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name = '';

  @IsInt()
  @Min(1)
  capacity = 0;
}
