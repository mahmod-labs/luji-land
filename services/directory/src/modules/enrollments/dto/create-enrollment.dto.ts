import { IsUUID } from 'class-validator';

// Client supplies the id (rule: client-generated UUIDs, decided this phase).
export class CreateEnrollmentDto {
  @IsUUID()
  id = '';

  @IsUUID()
  childId = '';

  @IsUUID()
  classroomId = '';
}
