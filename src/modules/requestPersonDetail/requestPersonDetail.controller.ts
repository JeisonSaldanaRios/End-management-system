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


import { RequestPersonDetailService } from './requestPersonDetail.service';
import type {
  CreateRequestPersonDetailDTO,
  PersonDetailStatus,
  PersonDetailType,
  UpdateRequestPersonDetailDTO,
} from './requestPersonDetail.model';
import { RequestPersonDetailEntity } from './requestPersonDetail.entity';

import { CreateRequestPersonDetailDto, UpdateRequestPersonDetailDto } from './dto';
@Controller('request-person-details')
@ApiTags('Request Person Detail')
export class RequestPersonDetailController {
  constructor(private readonly service: RequestPersonDetailService) {}
  @Post()
  @ApiOperation({ summary: 'Create Request Person Detail' })
  @ApiBody({ type: CreateRequestPersonDetailDto })
  @ApiCreatedResponseData(RequestPersonDetailEntity, { description: 'Request Person Detail created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateRequestPersonDetailDTO) {
    try {
      const detail = await this.service.createDetail(body);
      return {
        success: true,
        data: detail,
        message: 'Request person detail created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error creating request person detail',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Request Person Detail by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Request Person Detail id' })
  @ApiOkResponseData(RequestPersonDetailEntity, { description: 'Request Person Detail found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Request Person Detail not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const detail = await this.service.getDetailById(parsedId);
    if (!detail) throw new NotFoundException('Request person detail not found');

    return { success: true, data: detail };
  }
  @Get()
  @ApiOperation({ summary: 'List Request Person Detail' })
  @ApiOkResponseList(RequestPersonDetailEntity, { description: 'Request Person Detail list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('requestId') requestId?: string,
    @Query('detailType') detailType?: PersonDetailType,
    @Query('status') status?: PersonDetailStatus,
    @Query('personId') personId?: string,
    @Query('occupationId') occupationId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        requestId?: number;
        detailType?: PersonDetailType;
        status?: PersonDetailStatus;
        personId?: number;
        occupationId?: number;
        page?: number;
        limit?: number;
      } = {};

      if (requestId) {
        const parsedRequestId = parsePositiveInt(requestId, 'Invalid requestId');
        filters.requestId = parsedRequestId;
      }

      if (detailType) {
        filters.detailType = detailType;
      }

      if (status) {
        filters.status = status;
      }

      if (personId) {
        const parsedPersonId = parsePositiveInt(personId, 'Invalid personId');
        filters.personId = parsedPersonId;
      }

      if (occupationId) {
        const parsedOccupationId = parsePositiveInt(occupationId, 'Invalid occupationId');
        filters.occupationId = parsedOccupationId;
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
          : 'Error getting request person details',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Request Person Detail' })
  @ApiParam({ name: 'id', type: Number, description: 'Request Person Detail id' })
  @ApiBody({ type: UpdateRequestPersonDetailDto })
  @ApiOkResponseData(RequestPersonDetailEntity, { description: 'Request Person Detail updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Request Person Detail not found' })
  async update(@Param('id') id: string, @Body() body: UpdateRequestPersonDetailDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const detail = await this.service.updateDetail(parsedId, body);
      if (!detail) throw new NotFoundException('Request person detail not found');

      return {
        success: true,
        data: detail,
        message: 'Request person detail updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error updating request person detail',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Request Person Detail' })
  @ApiParam({ name: 'id', type: Number, description: 'Request Person Detail id' })
  @ApiOkResponseMessage({ description: 'Request Person Detail deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Request Person Detail not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteDetail(parsedId);
      if (!deleted) throw new NotFoundException('Request person detail not found');

      return { success: true, message: 'Request person detail deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error deleting request person detail',
      );
    }
  }
}
