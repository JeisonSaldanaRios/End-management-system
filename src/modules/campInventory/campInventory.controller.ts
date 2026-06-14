import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  ApiBadRequestResponse,
  ApiBody,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseList,
} from '../../common/swagger/api-response.decorator';
import { Roles } from '../../common/decorators';

import { CampInventoryService } from './campInventory.service';
import type { CreateCampInventoryDTO, UpdateCampInventoryDTO } from './campInventory.model';
import { CampInventoryEntity } from './campInventory.entity';
import { CreateCampInventoryDto } from './dto';
@Controller('camp-inventory')
@ApiTags('Camp Inventory')
export class CampInventoryController {
  constructor(private readonly service: CampInventoryService) {}

  private getCurrentUser(req: Request): { userId: number; campId: number; rol: string } {
    const currentUser = req.user as { userId?: number; campId?: number; rol?: string } | undefined;

    if (
      typeof currentUser?.userId !== 'number' ||
      currentUser.userId <= 0 ||
      typeof currentUser.campId !== 'number' ||
      currentUser.campId <= 0 ||
      typeof currentUser.rol !== 'string' ||
      !currentUser.rol
    ) {
      throw new BadRequestException('Authenticated user context is invalid');
    }

    return {
      userId: currentUser.userId,
      campId: currentUser.campId,
      rol: currentUser.rol,
    };
  }

  private isSystemAdmin(rol: string): boolean {
    return rol === 'SYSTEM_ADMIN';
  }
  @Post()
  @Roles('RESOURCE_MANAGEMENT')
  @ApiOperation({ summary: 'Create Camp Inventory' })
  @ApiBody({ type: CreateCampInventoryDto })
  @ApiCreatedResponseData(CampInventoryEntity, { description: 'Camp Inventory created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateCampInventoryDTO) {
    throw new ForbiddenException(
      'Inventory records are system-managed and cannot be created or deleted manually',
    );
  }

  @Get(':campId/:resourceTypeId')
  @Roles('RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER', 'SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Get Camp Inventory by campId and resourceTypeId' })
  @ApiParam({ name: 'campId', type: Number, description: 'Camp id' })
  @ApiParam({ name: 'resourceTypeId', type: Number, description: 'Resource Type id' })
  @ApiBadRequestResponse({ description: 'Invalid campId or resourceTypeId' })
  @ApiNotFoundResponse({ description: 'Camp Inventory not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getByKey(
    @Param('campId') campId: string,
    @Param('resourceTypeId') resourceTypeId: string,
    @Req() req: Request,
  ) {
    const parsedCampId = Number.parseInt(campId, 10);
    if (Number.isNaN(parsedCampId)) throw new BadRequestException('Invalid campId');

    const currentUser = this.getCurrentUser(req);
    if (!this.isSystemAdmin(currentUser.rol) && parsedCampId !== currentUser.campId) {
      throw new BadRequestException('You cannot view inventory from another camp');
    }

    const parsedResourceTypeId = Number.parseInt(resourceTypeId, 10);
    if (Number.isNaN(parsedResourceTypeId)) {
      throw new BadRequestException('Invalid resourceTypeId');
    }

    const item = await this.service.getItem(parsedCampId, parsedResourceTypeId);
    if (!item) throw new NotFoundException('Camp inventory item not found');

    return { success: true, data: item };
  }
  @Get()
  @Roles('RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER', 'SYSTEM_ADMIN')
  @ApiOperation({ summary: 'List Camp Inventory' })
  @ApiOkResponseList(CampInventoryEntity, { description: 'Camp Inventory list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (pagination)',
  })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getAll(
    @Query('campId') campId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ) {
    try {
      const filters: {
        campId?: number;
        resourceTypeId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (!req) {
        throw new BadRequestException('Request context is required');
      }

      const currentUser = this.getCurrentUser(req);
      const isAdmin = this.isSystemAdmin(currentUser.rol);

      if (!isAdmin) {
        filters.campId = currentUser.campId;
      }

      if (campId) {
        const parsedCampId = Number.parseInt(campId, 10);
        if (Number.isNaN(parsedCampId)) throw new BadRequestException('Invalid camp ID');

        if (!isAdmin && parsedCampId !== currentUser.campId) {
          throw new BadRequestException('You cannot query inventory from another camp');
        }

        filters.campId = parsedCampId;
      }

      if (resourceTypeId) {
        const parsedResourceTypeId = Number.parseInt(resourceTypeId, 10);
        if (Number.isNaN(parsedResourceTypeId)) {
          throw new BadRequestException('Invalid resource type ID');
        }
        filters.resourceTypeId = parsedResourceTypeId;
      }

      if (page) {
        const parsedPage = Number.parseInt(page, 10);
        if (Number.isNaN(parsedPage) || parsedPage < 1) {
          throw new BadRequestException('Invalid page');
        }
        filters.page = parsedPage;
      }

      if (limit) {
        const parsedLimit = Number.parseInt(limit, 10);
        if (Number.isNaN(parsedLimit) || parsedLimit < 1) {
          throw new BadRequestException('Invalid limit');
        }
        filters.limit = parsedLimit;
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
  @Roles('RESOURCE_MANAGEMENT')
  async update(
    @Param('campId') campId: string,
    @Param('resourceTypeId') resourceTypeId: string,
    @Body() body: UpdateCampInventoryDTO,
    @Req() req: Request,
  ) {
    const parsedCampId = Number.parseInt(campId, 10);
    if (Number.isNaN(parsedCampId)) throw new BadRequestException('Invalid campId');

    const currentUser = this.getCurrentUser(req);
    if (!this.isSystemAdmin(currentUser.rol) && parsedCampId !== currentUser.campId) {
      throw new BadRequestException('You cannot update inventory from another camp');
    }

    const parsedResourceTypeId = Number.parseInt(resourceTypeId, 10);
    if (Number.isNaN(parsedResourceTypeId)) {
      throw new BadRequestException('Invalid resourceTypeId');
    }

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
  @Roles('NO_ACCESS')
  @ApiOperation({ summary: 'Delete Camp Inventory' })
  @ApiParam({ name: 'campId', type: Number, description: 'Camp id' })
  @ApiParam({ name: 'resourceTypeId', type: Number, description: 'Resource Type id' })
  @ApiBadRequestResponse({ description: 'Invalid campId or resourceTypeId' })
  @ApiNotFoundResponse({ description: 'Camp Inventory not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async delete(@Param('campId') campId: string, @Param('resourceTypeId') resourceTypeId: string) {
    throw new ForbiddenException(
      'Inventory records are system-managed and cannot be created or deleted manually',
    );
  }
}
