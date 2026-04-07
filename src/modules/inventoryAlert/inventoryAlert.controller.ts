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


import { InventoryAlertService } from './inventoryAlert.service';
import type { CreateInventoryAlertDTO, UpdateInventoryAlertDTO } from './inventoryAlert.model';
import { InventoryAlertEntity } from './inventoryAlert.entity';

import { CreateInventoryAlertDto, UpdateInventoryAlertDto } from './dto';


@Controller('inventory-alerts')
@ApiTags('Inventory Alert')
export class InventoryAlertController {
  constructor(private readonly service: InventoryAlertService) {}
  @Post()
  @ApiOperation({ summary: 'Create Inventory Alert' })
  @ApiBody({ type: CreateInventoryAlertDto })
  @ApiCreatedResponseData(InventoryAlertEntity, { description: 'Inventory Alert created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateInventoryAlertDTO) {
    try {
      const alert = await this.service.createAlert(body);
      return {
        success: true,
        data: alert,
        message: 'Inventory alert created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating inventory alert',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Inventory Alert by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Inventory Alert id' })
  @ApiOkResponseData(InventoryAlertEntity, { description: 'Inventory Alert found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Inventory Alert not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const alert = await this.service.getAlertById(parsedId);
    if (!alert) throw new NotFoundException('Inventory alert not found');

    return { success: true, data: alert };
  }
  @Get()
  @ApiOperation({ summary: 'List Inventory Alert' })
  @ApiOkResponseList(InventoryAlertEntity, { description: 'Inventory Alert list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('resolved') resolved?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        resourceTypeId?: number;
        resolved?: boolean;
        page?: number;
        limit?: number;
      } = {};

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid camp ID');
        filters.campId = parsedCampId;
      }

      if (resourceTypeId) {
        const parsedResourceTypeId = parsePositiveInt(resourceTypeId, 'Invalid resource type ID');
        filters.resourceTypeId = parsedResourceTypeId;
      }

      if (resolved !== undefined) {
        if (resolved !== 'true' && resolved !== 'false') {
          throw new BadRequestException('Invalid resolved');
        }
        filters.resolved = resolved === 'true';
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllAlerts(filters);
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
        error instanceof Error ? error.message : 'Error getting inventory alerts',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Inventory Alert' })
  @ApiParam({ name: 'id', type: Number, description: 'Inventory Alert id' })
  @ApiBody({ type: UpdateInventoryAlertDto })
  @ApiOkResponseData(InventoryAlertEntity, { description: 'Inventory Alert updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Inventory Alert not found' })
  async update(@Param('id') id: string, @Body() body: UpdateInventoryAlertDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const alert = await this.service.updateAlert(parsedId, body);
      if (!alert) throw new NotFoundException('Inventory alert not found');

      return {
        success: true,
        data: alert,
        message: 'Inventory alert updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating inventory alert',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Inventory Alert' })
  @ApiParam({ name: 'id', type: Number, description: 'Inventory Alert id' })
  @ApiOkResponseMessage({ description: 'Inventory Alert deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Inventory Alert not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteAlert(parsedId);
      if (!deleted) throw new NotFoundException('Inventory alert not found');

      return { success: true, message: 'Inventory alert deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting inventory alert',
      );
    }
  }
}
