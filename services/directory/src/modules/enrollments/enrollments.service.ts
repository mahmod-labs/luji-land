import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, type Enrollment } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { appendOutbox } from '../../messaging/outbox';
import { CreateEnrollmentDto } from './dto/create-enrollment.dto';

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEnrollmentDto): Promise<Enrollment> {
    try {
      // The enrollment row and its event commit in one transaction: if the
      // capacity trigger rejects the insert, the transaction rolls back and NO
      // outbox row exists. A write never commits without its event.
      return await this.prisma.$transaction(async (tx) => {
        const enrollment = await tx.enrollment.create({ data: dto });
        await appendOutbox(tx, {
          topic: 'directory.child.enrolled',
          key: enrollment.childId,
          occurredAt: enrollment.createdAt,
          payload: {
            enrollmentId: enrollment.id,
            childId: enrollment.childId,
            classroomId: enrollment.classroomId,
          },
        });
        return enrollment;
      });
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

// Prisma surfaces the capacity trigger's RAISE not as a mapped known-code error
// but as a raw connector error whose message carries the exception text. Match
// ONLY that text — SQLSTATE 23514 is the generic check_violation code, so any
// future CHECK constraint would share it and get mis-mapped to a false 409.
// The literal comes from the trigger in 0002_*/migration.sql: 'is at capacity'.
function isCapacityRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : '';
  return message.includes('is at capacity');
}
