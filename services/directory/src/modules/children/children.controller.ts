import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { ChildrenService } from './children.service';
import { CreateChildDto } from './dto/create-child.dto';

@Controller('children')
export class ChildrenController {
  constructor(private readonly children: ChildrenService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() dto: CreateChildDto) {
    return this.children.create(dto);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.children.findOne(id);
  }
}
