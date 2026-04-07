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


import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';


import { ExpeditionResourceObtainedService } from './expeditionResourceObtained.service';
import type {
  CreateExpeditionResourceObtainedDTO,
  UpdateExpeditionResourceObtainedDTO,
} from './expeditionResourceObtained.model';
import { ExpeditionResourceObtainedEntity } from './expeditionResourceObtained.entity';

import { CreateExpeditionResourceObtainedDto, UpdateExpeditionResourceObtainedDto } from './dto';
@Controller('expedition-resources-obtained')
@ApiTags('Expedition Resource Obtained')
export class ExpeditionResourceObtainedController {
  constructor(private readonly service: ExpeditionResourceObtainedService) {}
  @Post()
  @ApiOperation({ summary: 'Create Expedition Resource Obtained' })
  @ApiBody({ type: CreateExpeditionResourceObtainedDto })
  @ApiCreatedResponseData(ExpeditionResourceObtainedEntity, { description: 'Expedition Resource Obtained created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateExpeditionResourceObtainedDTO) {
    try {
      const record = await this.service.createRecord(body);
      return {
        success: true,
        data: record,
        message: 'Expedition obtained resource recorded successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error creating expedition resource obtained record',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Expedition Resource Obtained by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Expedition Resource Obtained id' })
  @ApiOkResponseData(ExpeditionResourceObtainedEntity, { description: 'Expedition Resource Obtained found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Expedition Resource Obtained not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const record = await this.service.getRecordById(parsedId);
    if (!record) throw new NotFoundException('Record not found');

    return { success: true, data: record };
  }
  @Get()
  @ApiOperation({ summary: 'List Expedition Resource Obtained' })
  @ApiOkResponseList(ExpeditionResourceObtainedEntity, { description: 'Expedition Resource Obtained list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('expeditionId') expeditionId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('recordedBy') recordedBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        expeditionId?: number;
        resourceTypeId?: number;
        recordedBy?: number;
        page?: number;
        limit?: number;
      } = {};

      if (expeditionId) {
        const parsedExpeditionId = parsePositiveInt(expeditionId, 'Invalid expeditionId');
        filters.expeditionId = parsedExpeditionId;
      }

      if (resourceTypeId) {
        const parsedResourceTypeId = parsePositiveInt(resourceTypeId, 'Invalid resourceTypeId');
        filters.resourceTypeId = parsedResourceTypeId;
      }

      if (recordedBy) {
        const parsedRecordedBy = parsePositiveInt(recordedBy, 'Invalid recordedBy');
        filters.recordedBy = parsedRecordedBy;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllRecords(filters);
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
        error instanceof Error
          ? error.message
          : 'Error getting expedition resource obtained records',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Expedition Resource Obtained' })
  @ApiParam({ name: 'id', type: Number, description: 'Expedition Resource Obtained id' })
  @ApiBody({ type: UpdateExpeditionResourceObtainedDto })
  @ApiOkResponseData(ExpeditionResourceObtainedEntity, { description: 'Expedition Resource Obtained updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Expedition Resource Obtained not found' })
  async update(@Param('id') id: string, @Body() body: UpdateExpeditionResourceObtainedDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const record = await this.service.updateRecord(parsedId, body);
      if (!record) throw new NotFoundException('Record not found');

      return {
        success: true,
        data: record,
        message: 'Record updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error updating expedition resource obtained record',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Expedition Resource Obtained' })
  @ApiParam({ name: 'id', type: Number, description: 'Expedition Resource Obtained id' })
  @ApiOkResponseMessage({ description: 'Expedition Resource Obtained deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Expedition Resource Obtained not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteRecord(parsedId);
      if (!deleted) throw new NotFoundException('Record not found');

      return { success: true, message: 'Record deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error deleting expedition resource obtained record',
      );
    }
  }
}
