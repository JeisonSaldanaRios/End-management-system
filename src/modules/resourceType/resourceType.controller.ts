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
} from '@nestjs/common';

import {
  ApiBadRequestResponse,
  ApiBody,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { Roles } from '../../common/decorators';

import { ResourceTypeService } from './resourceType.service';
import type {
  CreateResourceTypeDTO,
  ResourceCategory,
  UpdateResourceTypeDTO,
} from './resourceType.model';
import { ResourceTypeEntity } from './resourceType.entity';

import { CreateResourceTypeDto, UpdateResourceTypeDto } from './dto';
@Controller('resource-types')
@ApiTags('Resource Type')
export class ResourceTypeController {
  constructor(private readonly service: ResourceTypeService) {}
  @Post()
  @Roles('RESOURCE_MANAGEMENT')
  @ApiOperation({ summary: 'Create Resource Type' })
  @ApiBody({ type: CreateResourceTypeDto })
  @ApiCreatedResponseData(ResourceTypeEntity, { description: 'Resource Type created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async create(@Body() body: CreateResourceTypeDTO) {
    throw new ForbiddenException(
      'Resource types are system catalogs and cannot be modified via API',
    );
  }
  @Get(':id')
  @Roles('RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER', 'SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Get Resource Type by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Resource Type id' })
  @ApiOkResponseData(ResourceTypeEntity, { description: 'Resource Type found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Resource Type not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    const resourceType = await this.service.getResourceTypeById(parsedId);
    if (!resourceType) throw new NotFoundException('Resource type not found');

    return { success: true, data: resourceType };
  }
  @Get()
  @Roles('RESOURCE_MANAGEMENT', 'TRAVEL_MANAGER', 'SYSTEM_ADMIN')
  @ApiOperation({ summary: 'List Resource Type' })
  @ApiOkResponseList(ResourceTypeEntity, { description: 'Resource Type list' })
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
    @Query('category') category?: ResourceCategory,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        category?: ResourceCategory;
        page?: number;
        limit?: number;
      } = {};

      if (category) {
        filters.category = category;
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

      const result = await this.service.getAllResourceTypes(filters);
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
        error instanceof Error ? error.message : 'Error getting resource types',
      );
    }
  }
  @Put(':id')
  @Roles('RESOURCE_MANAGEMENT')
  @ApiOperation({ summary: 'Update Resource Type' })
  @ApiParam({ name: 'id', type: Number, description: 'Resource Type id' })
  @ApiBody({ type: UpdateResourceTypeDto })
  @ApiOkResponseData(ResourceTypeEntity, { description: 'Resource Type updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Resource Type not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async update(@Param('id') id: string, @Body() body: UpdateResourceTypeDTO) {
    throw new ForbiddenException(
      'Resource types are system catalogs and cannot be modified via API',
    );
  }
  @Delete(':id')
  @Roles('RESOURCE_MANAGEMENT')
  @ApiOperation({ summary: 'Delete Resource Type' })
  @ApiParam({ name: 'id', type: Number, description: 'Resource Type id' })
  @ApiOkResponseMessage({ description: 'Resource Type deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Resource Type not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async delete(@Param('id') id: string) {
    throw new ForbiddenException(
      'Resource types are system catalogs and cannot be modified via API',
    );
  }
}
