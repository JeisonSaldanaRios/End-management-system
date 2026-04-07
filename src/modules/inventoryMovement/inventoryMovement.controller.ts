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


import { InventoryMovementService } from './inventoryMovement.service';
import type {
  CreateInventoryMovementDTO,
  InventoryMovementType,
  UpdateInventoryMovementDTO,
} from './inventoryMovement.model';
import { InventoryMovementEntity } from './inventoryMovement.entity';

import { CreateInventoryMovementDto, UpdateInventoryMovementDto } from './dto';
@Controller('inventory-movements')
@ApiTags('Inventory Movement')
export class InventoryMovementController {
  constructor(private readonly service: InventoryMovementService) {}
  @Post()
  @ApiOperation({ summary: 'Create Inventory Movement' })
  @ApiBody({ type: CreateInventoryMovementDto })
  @ApiCreatedResponseData(InventoryMovementEntity, { description: 'Inventory Movement created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateInventoryMovementDTO) {
    try {
      const movement = await this.service.createMovement(body);
      return {
        success: true,
        data: movement,
        message: 'Inventory movement created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating inventory movement',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Inventory Movement by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Inventory Movement id' })
  @ApiOkResponseData(InventoryMovementEntity, { description: 'Inventory Movement found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Inventory Movement not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const movement = await this.service.getMovementById(parsedId);
    if (!movement) throw new NotFoundException('Inventory movement not found');

    return { success: true, data: movement };
  }
  @Get()
  @ApiOperation({ summary: 'List Inventory Movement' })
  @ApiOkResponseList(InventoryMovementEntity, { description: 'Inventory Movement list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('movementType') movementType?: InventoryMovementType,
    @Query('recordedBy') recordedBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        resourceTypeId?: number;
        movementType?: InventoryMovementType;
        recordedBy?: number;
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

      if (movementType) {
        filters.movementType = movementType;
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

      const result = await this.service.getAllMovements(filters);
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
        error instanceof Error ? error.message : 'Error getting inventory movements',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Inventory Movement' })
  @ApiParam({ name: 'id', type: Number, description: 'Inventory Movement id' })
  @ApiBody({ type: UpdateInventoryMovementDto })
  @ApiOkResponseData(InventoryMovementEntity, { description: 'Inventory Movement updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Inventory Movement not found' })
  async update(@Param('id') id: string, @Body() body: UpdateInventoryMovementDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const movement = await this.service.updateMovement(parsedId, body);
      if (!movement) throw new NotFoundException('Inventory movement not found');

      return {
        success: true,
        data: movement,
        message: 'Inventory movement updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating inventory movement',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Inventory Movement' })
  @ApiParam({ name: 'id', type: Number, description: 'Inventory Movement id' })
  @ApiOkResponseMessage({ description: 'Inventory Movement deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Inventory Movement not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteMovement(parsedId);
      if (!deleted) throw new NotFoundException('Inventory movement not found');

      return { success: true, message: 'Inventory movement deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting inventory movement',
      );
    }
  }
}
