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


import { DeliveredTransferResourceService } from './deliveredTransferResource.service';
import type {
  CreateDeliveredTransferResourceDTO,
  UpdateDeliveredTransferResourceDTO,
} from './deliveredTransferResource.model';
import { DeliveredTransferResourceEntity } from './deliveredTransferResource.entity';

import { CreateDeliveredTransferResourceDto, UpdateDeliveredTransferResourceDto } from './dto';
@Controller('delivered-transfer-resources')
@ApiTags('Delivered Transfer Resource')
export class DeliveredTransferResourceController {
  constructor(private readonly service: DeliveredTransferResourceService) {}
  @Post()
  @ApiOperation({ summary: 'Create Delivered Transfer Resource' })
  @ApiBody({ type: CreateDeliveredTransferResourceDto })
  @ApiCreatedResponseData(DeliveredTransferResourceEntity, { description: 'Delivered Transfer Resource created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateDeliveredTransferResourceDTO) {
    try {
      const delivered = await this.service.createDeliveredResource(body);
      return {
        success: true,
        data: delivered,
        message: 'Delivered transfer resource created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error creating delivered transfer resource',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Delivered Transfer Resource by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Delivered Transfer Resource id' })
  @ApiOkResponseData(DeliveredTransferResourceEntity, { description: 'Delivered Transfer Resource found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Delivered Transfer Resource not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const delivered = await this.service.getDeliveredResourceById(parsedId);
    if (!delivered) throw new NotFoundException('Delivered transfer resource not found');

    return { success: true, data: delivered };
  }
  @Get()
  @ApiOperation({ summary: 'List Delivered Transfer Resource' })
  @ApiOkResponseList(DeliveredTransferResourceEntity, { description: 'Delivered Transfer Resource list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('transferId') transferId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        transferId?: number;
        resourceTypeId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (transferId) {
        const parsedTransferId = parsePositiveInt(transferId, 'Invalid transferId');
        filters.transferId = parsedTransferId;
      }

      if (resourceTypeId) {
        const parsedResourceTypeId = parsePositiveInt(resourceTypeId, 'Invalid resourceTypeId');
        filters.resourceTypeId = parsedResourceTypeId;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllDeliveredResources(filters);
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
          : 'Error getting delivered transfer resources',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Delivered Transfer Resource' })
  @ApiParam({ name: 'id', type: Number, description: 'Delivered Transfer Resource id' })
  @ApiBody({ type: UpdateDeliveredTransferResourceDto })
  @ApiOkResponseData(DeliveredTransferResourceEntity, { description: 'Delivered Transfer Resource updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Delivered Transfer Resource not found' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateDeliveredTransferResourceDTO,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const delivered = await this.service.updateDeliveredResource(parsedId, body);
      if (!delivered) {
        throw new NotFoundException('Delivered transfer resource not found');
      }

      return {
        success: true,
        data: delivered,
        message: 'Delivered transfer resource updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error updating delivered transfer resource',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Delivered Transfer Resource' })
  @ApiParam({ name: 'id', type: Number, description: 'Delivered Transfer Resource id' })
  @ApiOkResponseMessage({ description: 'Delivered Transfer Resource deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Delivered Transfer Resource not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteDeliveredResource(parsedId);
      if (!deleted) {
        throw new NotFoundException('Delivered transfer resource not found');
      }

      return {
        success: true,
        message: 'Delivered transfer resource deleted successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error deleting delivered transfer resource',
      );
    }
  }
}
