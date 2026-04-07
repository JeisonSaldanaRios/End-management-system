import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';


import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';

import { PersonService } from './person.service';
import type {
  CreatePersonDTO,
  PersonStatus,
  UpdatePersonDTO,
} from './person.model';
import { PersonEntity } from './person.entity';

import { CreatePersonDto, UpdatePersonDto } from './dto';
@Controller('persons')
@ApiTags('Person')
export class PersonController {
  constructor(private readonly service: PersonService) {}
  @Post()
  @ApiOperation({ summary: 'Create Person' })
  @ApiBody({ type: CreatePersonDto })
  @ApiCreatedResponseData(PersonEntity, { description: 'Person created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreatePersonDTO) {
    try {
      const person = await this.service.createPerson(body);
      return {
        success: true,
        data: person,
        message: 'Person created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating person',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Person by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiOkResponseData(PersonEntity, { description: 'Person found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Person not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const person = await this.service.getPersonById(parsedId);
    if (!person) throw new NotFoundException('Person not found');

    return { success: true, data: person };
  }
  @Get()
  @ApiOperation({ summary: 'List Person' })
  @ApiOkResponseList(PersonEntity, { description: 'Person list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('currentStatus') currentStatus?: PersonStatus,
    @Query('occupationId') occupationId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        currentStatus?: PersonStatus;
        occupationId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid camp ID');
        filters.campId = parsedCampId;
      }

      if (currentStatus) {
        filters.currentStatus = currentStatus;
      }

      if (occupationId) {
        const parsedOccupationId = parsePositiveInt(occupationId, 'Invalid occupation ID');
        filters.occupationId = parsedOccupationId;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllPersons(filters);
      const resolvedPage = filters.page ?? 1;
      const resolvedLimit = filters.limit ?? 10;

      return {
        success: true,
        data: result.data,
        pagination: {
          page: resolvedPage,
          limit: resolvedLimit,
          total: result.total,
          pages: Math.ceil(result.total / resolvedLimit),
        },
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error getting persons',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Person' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiBody({ type: UpdatePersonDto })
  @ApiOkResponseData(PersonEntity, { description: 'Person updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Person not found' })
  async update(@Param('id') id: string, @Body() body: UpdatePersonDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const person = await this.service.updatePerson(parsedId, body);
      if (!person) throw new NotFoundException('Person not found');

      return {
        success: true,
        data: person,
        message: 'Person updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating person',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Person' })
  @ApiParam({ name: 'id', type: Number, description: 'Person id' })
  @ApiOkResponseMessage({ description: 'Person deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Person not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deletePerson(parsedId);
      if (!deleted) throw new NotFoundException('Person not found');

      return { success: true, message: 'Person deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting person',
      );
    }
  }
}
