import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Child } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateChildDto } from './dto/create-child.dto';

@Injectable()
export class ChildrenService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateChildDto): Promise<Child> {
    try {
      return await this.prisma.child.create({ data: dto });
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
