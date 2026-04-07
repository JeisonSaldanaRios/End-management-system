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

import {
  assertEnumValue,
  assertNonEmptyPayload,
  COMMON_MAX_LENGTH,
  parsePositiveInt,
  validateStringFieldsMaxLength,
} from '../../common/validation/request-validation.util';


import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';


import { ResourceTypeService } from './resourceType.service';
import type {
  CreateResourceTypeDTO,
  ResourceCategory,
  UpdateResourceTypeDTO,
} from './resourceType.model';
import { RESOURCE_CATEGORY_VALUES } from './resourceType.model';
import { ResourceTypeEntity } from './resourceType.entity';

import { CreateResourceTypeDto, UpdateResourceTypeDto } from './dto';
@Controller('resource-types')
@ApiTags('Resource Type')
export class ResourceTypeController {
  constructor(private readonly service: ResourceTypeService) {}
  @Post()
  @ApiOperation({ summary: 'Create Resource Type' })
  @ApiBody({ type: CreateResourceTypeDto })
  @ApiCreatedResponseData(ResourceTypeEntity, { description: 'Resource Type created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateResourceTypeDTO) {
    validateStringFieldsMaxLength([
      { fieldName: 'name', value: body.name, maxLength: COMMON_MAX_LENGTH.name, required: true },
      { fieldName: 'unitOfMeasure', value: body.unitOfMeasure, maxLength: COMMON_MAX_LENGTH.shortText, required: true },
      { fieldName: 'description', value: body.description, maxLength: COMMON_MAX_LENGTH.longText, allowNull: true },
    ]);

    assertEnumValue(body.category, RESOURCE_CATEGORY_VALUES, 'Invalid category');

    try {
      const resourceType = await this.service.createResourceType(body);
      return {
        success: true,
        data: resourceType,
        message: 'Resource type created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating resource type',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Resource Type by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Resource Type id' })
  @ApiOkResponseData(ResourceTypeEntity, { description: 'Resource Type found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Resource Type not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const resourceType = await this.service.getResourceTypeById(parsedId);
    if (!resourceType) throw new NotFoundException('Resource type not found');

    return { success: true, data: resourceType };
  }
  @Get()
  @ApiOperation({ summary: 'List Resource Type' })
  @ApiOkResponseList(ResourceTypeEntity, { description: 'Resource Type list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
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
        assertEnumValue(category, RESOURCE_CATEGORY_VALUES, 'Invalid category');
        filters.category = category;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
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
  @ApiOperation({ summary: 'Update Resource Type' })
  @ApiParam({ name: 'id', type: Number, description: 'Resource Type id' })
  @ApiBody({ type: UpdateResourceTypeDto })
  @ApiOkResponseData(ResourceTypeEntity, { description: 'Resource Type updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Resource Type not found' })
  async update(@Param('id') id: string, @Body() body: UpdateResourceTypeDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    assertNonEmptyPayload(body);

    validateStringFieldsMaxLength([
      { fieldName: 'name', value: body.name, maxLength: COMMON_MAX_LENGTH.name },
      { fieldName: 'unitOfMeasure', value: body.unitOfMeasure, maxLength: COMMON_MAX_LENGTH.shortText },
      { fieldName: 'description', value: body.description, maxLength: COMMON_MAX_LENGTH.longText, allowNull: true },
    ]);

    if (body.category) {
      assertEnumValue(body.category, RESOURCE_CATEGORY_VALUES, 'Invalid category');
    }

    try {
      const resourceType = await this.service.updateResourceType(parsedId, body);
      if (!resourceType) throw new NotFoundException('Resource type not found');

      return {
        success: true,
        data: resourceType,
        message: 'Resource type updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating resource type',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Resource Type' })
  @ApiParam({ name: 'id', type: Number, description: 'Resource Type id' })
  @ApiOkResponseMessage({ description: 'Resource Type deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Resource Type not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteResourceType(parsedId);
      if (!deleted) throw new NotFoundException('Resource type not found');

      return { success: true, message: 'Resource type deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting resource type',
      );
    }
  }
}
