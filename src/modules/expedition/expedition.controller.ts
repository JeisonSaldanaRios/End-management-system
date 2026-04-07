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


import { ExpeditionService } from './expedition.service';
import type {
  CreateExpeditionDTO,
  ExpeditionStatus,
  UpdateExpeditionDTO,
} from './expedition.model';
import { ExpeditionEntity } from './expedition.entity';

import { CreateExpeditionDto, UpdateExpeditionDto } from './dto';
@Controller('expeditions')
@ApiTags('Expedition')
export class ExpeditionController {
  constructor(private readonly service: ExpeditionService) {}
  @Post()
  @ApiOperation({ summary: 'Create Expedition' })
  @ApiBody({ type: CreateExpeditionDto })
  @ApiCreatedResponseData(ExpeditionEntity, { description: 'Expedition created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateExpeditionDTO) {
    try {
      const expedition = await this.service.createExpedition(body);
      return {
        success: true,
        data: expedition,
        message: 'Expedition created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating expedition',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Expedition by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Expedition id' })
  @ApiOkResponseData(ExpeditionEntity, { description: 'Expedition found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Expedition not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const expedition = await this.service.getExpeditionById(parsedId);
    if (!expedition) throw new NotFoundException('Expedition not found');

    return { success: true, data: expedition };
  }
  @Get()
  @ApiOperation({ summary: 'List Expedition' })
  @ApiOkResponseList(ExpeditionEntity, { description: 'Expedition list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('status') status?: ExpeditionStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        status?: ExpeditionStatus;
        page?: number;
        limit?: number;
      } = {};

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
        filters.campId = parsedCampId;
      }

      if (status) {
        filters.status = status;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllExpeditions(filters);
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
        error instanceof Error ? error.message : 'Error getting expeditions',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Expedition' })
  @ApiParam({ name: 'id', type: Number, description: 'Expedition id' })
  @ApiBody({ type: UpdateExpeditionDto })
  @ApiOkResponseData(ExpeditionEntity, { description: 'Expedition updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Expedition not found' })
  async update(@Param('id') id: string, @Body() body: UpdateExpeditionDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const expedition = await this.service.updateExpedition(parsedId, body);
      if (!expedition) throw new NotFoundException('Expedition not found');

      return {
        success: true,
        data: expedition,
        message: 'Expedition updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating expedition',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Expedition' })
  @ApiParam({ name: 'id', type: Number, description: 'Expedition id' })
  @ApiOkResponseMessage({ description: 'Expedition deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Expedition not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteExpedition(parsedId);
      if (!deleted) throw new NotFoundException('Expedition not found');

      return { success: true, message: 'Expedition deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting expedition',
      );
    }
  }
}
