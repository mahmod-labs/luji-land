import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type Enrollment } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEnrollmentDto): Promise<Enrollment> {
    try {
      return await this.prisma.enrollment.create({ data: dto });
    } catch (err) {
      // The capacity check lives in a DB trigger (migration 0002), so a full
      // room surfaces here as a raised exception, not something the service
      // decided. Map that rejection — and a duplicate id / already-enrolled
      // child — to 409. The trigger, not this catch, is what makes it race-safe.
      if (isCapacityRejection(err)) {
        throw new ConflictException(
          `classroom ${dto.classroomId} is at capacity`,
        );
      }
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`child ${dto.childId} is already enrolled`);
      }
      throw err;
    }
  }
}

// The trigger raises SQLSTATE 23514 (check_violation). Prisma surfaces a
// trigger RAISE not as a mapped known-code error but as a raw connector error
// whose message carries the Postgres code and text, so match on those.
function isCapacityRejection(err: unknown): boolean {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : '';
  return message.includes('23514') || message.includes('at capacity');
}
