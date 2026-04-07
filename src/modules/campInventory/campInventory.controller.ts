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
  ApiOkResponseList,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';


import { CampInventoryService } from './campInventory.service';
import type {
  CreateCampInventoryDTO,
  UpdateCampInventoryDTO,
} from './campInventory.model';
import { CampInventoryEntity } from './campInventory.entity';

import { CreateCampInventoryDto, UpdateCampInventoryDto } from './dto';
@Controller('camp-inventory')
@ApiTags('Camp Inventory')
export class CampInventoryController {
  constructor(private readonly service: CampInventoryService) {}
  @Post()
  @ApiOperation({ summary: 'Create Camp Inventory' })
  @ApiBody({ type: CreateCampInventoryDto })
  @ApiCreatedResponseData(CampInventoryEntity, { description: 'Camp Inventory created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateCampInventoryDTO) {
    try {
      const item = await this.service.createItem(body);
      return {
        success: true,
        data: item,
        message: 'Camp inventory item created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating camp inventory item',
      );
    }
  }

  @Get(':campId/:resourceTypeId')
  async getByKey(
    @Param('campId') campId: string,
    @Param('resourceTypeId') resourceTypeId: string,
  ) {
    const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
    const parsedResourceTypeId = parsePositiveInt(resourceTypeId, 'Invalid resourceTypeId');

    const item = await this.service.getItem(parsedCampId, parsedResourceTypeId);
    if (!item) throw new NotFoundException('Camp inventory item not found');

    return { success: true, data: item };
  }
  @Get()
  @ApiOperation({ summary: 'List Camp Inventory' })
  @ApiOkResponseList(CampInventoryEntity, { description: 'Camp Inventory list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        resourceTypeId?: number;
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

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllItems(filters);
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
        error instanceof Error ? error.message : 'Error getting camp inventory',
      );
    }
  }

  @Put(':campId/:resourceTypeId')
  async update(
    @Param('campId') campId: string,
    @Param('resourceTypeId') resourceTypeId: string,
    @Body() body: UpdateCampInventoryDTO,
  ) {
    const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
    const parsedResourceTypeId = parsePositiveInt(resourceTypeId, 'Invalid resourceTypeId');

    try {
      const item = await this.service.updateItem(parsedCampId, parsedResourceTypeId, body);
      if (!item) throw new NotFoundException('Camp inventory item not found');

      return {
        success: true,
        data: item,
        message: 'Camp inventory item updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating camp inventory item',
      );
    }
  }

  @Delete(':campId/:resourceTypeId')
  async delete(
    @Param('campId') campId: string,
    @Param('resourceTypeId') resourceTypeId: string,
  ) {
    const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
    const parsedResourceTypeId = parsePositiveInt(resourceTypeId, 'Invalid resourceTypeId');

    try {
      const deleted = await this.service.deleteItem(parsedCampId, parsedResourceTypeId);
      if (!deleted) throw new NotFoundException('Camp inventory item not found');

      return { success: true, message: 'Camp inventory item deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting camp inventory item',
      );
    }
  }
}
