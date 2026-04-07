import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';


import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';


import { PersonStatusHistoryService } from './personStatusHistory.service';
import type {
  CreatePersonStatusHistoryDTO,
  PersonStatus,
  UpdatePersonStatusHistoryDTO,
} from './personStatusHistory.model';
import { PersonStatusHistoryEntity } from './personStatusHistory.entity';

import { CreatePersonStatusHistoryDto, UpdatePersonStatusHistoryDto } from './dto';
@Controller('person-status-history')
@ApiTags('Person Status History')
export class PersonStatusHistoryController {
  constructor(private readonly service: PersonStatusHistoryService) {}
  @Post()
  @ApiOperation({ summary: 'Create Person Status History' })
  @ApiBody({ type: CreatePersonStatusHistoryDto })
  @ApiCreatedResponseData(PersonStatusHistoryEntity, { description: 'Person Status History created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreatePersonStatusHistoryDTO) {
    try {
      const entry = await this.service.createEntry(body);
      return {
        success: true,
        data: entry,
        message: 'Person status history entry created successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating person status history entry',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Person Status History by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Person Status History id' })
  @ApiOkResponseData(PersonStatusHistoryEntity, { description: 'Person Status History found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Person Status History not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const entry = await this.service.getEntryById(parsedId);
    if (!entry) throw new NotFoundException('Person status history entry not found');

    return { success: true, data: entry };
  }
  @Get()
  @ApiOperation({ summary: 'List Person Status History' })
  @ApiOkResponseList(PersonStatusHistoryEntity, { description: 'Person Status History list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('personId') personId?: string,
    @Query('changedBy') changedBy?: string,
    @Query('previousStatus') previousStatus?: PersonStatus,
    @Query('newStatus') newStatus?: PersonStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        personId?: number;
        changedBy?: number;
        previousStatus?: PersonStatus;
        newStatus?: PersonStatus;
        page?: number;
        limit?: number;
      } = {};

      if (personId) {
        const parsedPersonId = parsePositiveInt(personId, 'Invalid personId');
        filters.personId = parsedPersonId;
      }

      if (changedBy) {
        const parsedChangedBy = parsePositiveInt(changedBy, 'Invalid changedBy');
        filters.changedBy = parsedChangedBy;
      }

      if (previousStatus) {
        filters.previousStatus = previousStatus;
      }

      if (newStatus) {
        filters.newStatus = newStatus;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllEntries(filters);
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
        error instanceof Error ? error.message : 'Error getting person status history',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Person Status History' })
  @ApiParam({ name: 'id', type: Number, description: 'Person Status History id' })
  @ApiBody({ type: UpdatePersonStatusHistoryDto })
  @ApiOkResponseData(PersonStatusHistoryEntity, { description: 'Person Status History updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Person Status History not found' })
  async update(@Param('id') id: string, @Body() body: UpdatePersonStatusHistoryDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const entry = await this.service.updateEntry(parsedId, body);
      if (!entry) throw new NotFoundException('Person status history entry not found');

      return {
        success: true,
        data: entry,
        message: 'Person status history entry updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating person status history entry',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Person Status History' })
  @ApiParam({ name: 'id', type: Number, description: 'Person Status History id' })
  @ApiOkResponseMessage({ description: 'Person Status History deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Person Status History not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteEntry(parsedId);
      if (!deleted) throw new NotFoundException('Person status history entry not found');

      return { success: true, message: 'Person status history entry deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting person status history entry',
      );
    }
  }
}
