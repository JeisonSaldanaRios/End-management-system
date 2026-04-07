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


import { RequestResourceDetailService } from './requestResourceDetail.service';
import type {
  CreateRequestResourceDetailDTO,
  UpdateRequestResourceDetailDTO,
} from './requestResourceDetail.model';
import { RequestResourceDetailEntity } from './requestResourceDetail.entity';

import { CreateRequestResourceDetailDto, UpdateRequestResourceDetailDto } from './dto';
@Controller('request-resource-details')
@ApiTags('Request Resource Detail')
export class RequestResourceDetailController {
  constructor(private readonly service: RequestResourceDetailService) {}
  @Post()
  @ApiOperation({ summary: 'Create Request Resource Detail' })
  @ApiBody({ type: CreateRequestResourceDetailDto })
  @ApiCreatedResponseData(RequestResourceDetailEntity, { description: 'Request Resource Detail created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateRequestResourceDetailDTO) {
    try {
      const detail = await this.service.createDetail(body);
      return {
        success: true,
        data: detail,
        message: 'Request resource detail created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error creating request resource detail',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Request Resource Detail by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Request Resource Detail id' })
  @ApiOkResponseData(RequestResourceDetailEntity, { description: 'Request Resource Detail found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Request Resource Detail not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const detail = await this.service.getDetailById(parsedId);
    if (!detail) throw new NotFoundException('Request resource detail not found');

    return { success: true, data: detail };
  }
  @Get()
  @ApiOperation({ summary: 'List Request Resource Detail' })
  @ApiOkResponseList(RequestResourceDetailEntity, { description: 'Request Resource Detail list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('requestId') requestId?: string,
    @Query('resourceTypeId') resourceTypeId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        requestId?: number;
        resourceTypeId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (requestId) {
        const parsedRequestId = parsePositiveInt(requestId, 'Invalid requestId');
        filters.requestId = parsedRequestId;
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

      const result = await this.service.getAllDetails(filters);
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
          : 'Error getting request resource details',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Request Resource Detail' })
  @ApiParam({ name: 'id', type: Number, description: 'Request Resource Detail id' })
  @ApiBody({ type: UpdateRequestResourceDetailDto })
  @ApiOkResponseData(RequestResourceDetailEntity, { description: 'Request Resource Detail updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Request Resource Detail not found' })
  async update(@Param('id') id: string, @Body() body: UpdateRequestResourceDetailDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const detail = await this.service.updateDetail(parsedId, body);
      if (!detail) throw new NotFoundException('Request resource detail not found');

      return {
        success: true,
        data: detail,
        message: 'Request resource detail updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error updating request resource detail',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Request Resource Detail' })
  @ApiParam({ name: 'id', type: Number, description: 'Request Resource Detail id' })
  @ApiOkResponseMessage({ description: 'Request Resource Detail deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Request Resource Detail not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteDetail(parsedId);
      if (!deleted) throw new NotFoundException('Request resource detail not found');

      return {
        success: true,
        message: 'Request resource detail deleted successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error deleting request resource detail',
      );
    }
  }
}
