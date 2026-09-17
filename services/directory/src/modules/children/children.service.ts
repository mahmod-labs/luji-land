import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Child } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { appendOutbox } from '../../messaging/outbox';
import { CreateChildDto } from './dto/create-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChildDto): Promise<Child> {
    try {
      // Child row and its event commit together (transactional outbox).
      return await this.prisma.$transaction(async (tx) => {
        const child = await tx.child.create({ data: dto });
        await appendOutbox(tx, {
          topic: 'directory.child.created',
          key: child.id,
          occurredAt: child.createdAt,
          payload: {
            childId: child.id,
            firstName: child.firstName,
            lastName: child.lastName,
          },
        });
        return child;
      });
    } catch (err) {
      // P2002 = unique violation: the client-supplied id already exists.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(`child ${dto.id} already exists`);
      }
      throw err;
    }
  }

  async findOne(id: string): Promise<Child> {
    const child = await this.prisma.child.findUnique({ where: { id } });
    if (!child) {
      throw new NotFoundException(`child ${id} not found`);
    }
    return child;
  }
}
