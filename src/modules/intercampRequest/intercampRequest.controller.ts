import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
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


import { IntercampRequestService } from './intercampRequest.service';
import type {
  CreateIntercampRequestDTO,
  IntercampRequestStatus,
  UpdateIntercampRequestDTO,
} from './intercampRequest.model';
import { IntercampRequestEntity } from './intercampRequest.entity';

import { CreateIntercampRequestDto, UpdateIntercampRequestDto } from './dto';
@Controller('intercamp-requests')
@ApiTags('Intercamp Request')
export class IntercampRequestController {
  constructor(private readonly service: IntercampRequestService) {}
  @Post()
  @ApiOperation({ summary: 'Create Intercamp Request' })
  @ApiBody({ type: CreateIntercampRequestDto })
  @ApiCreatedResponseData(IntercampRequestEntity, { description: 'Intercamp Request created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateIntercampRequestDTO) {
    try {
      const request = await this.service.createRequest(body);
      return {
        success: true,
        data: request,
        message: 'Intercamp request created successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating intercamp request',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Intercamp Request by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Intercamp Request id' })
  @ApiOkResponseData(IntercampRequestEntity, { description: 'Intercamp Request found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Intercamp Request not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const request = await this.service.getRequestById(parsedId);
    if (!request) throw new NotFoundException('Intercamp request not found');

    return { success: true, data: request };
  }
  @Get()
  @ApiOperation({ summary: 'List Intercamp Request' })
  @ApiOkResponseList(IntercampRequestEntity, { description: 'Intercamp Request list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('originCampId') originCampId?: string,
    @Query('destinationCampId') destinationCampId?: string,
    @Query('status') status?: IntercampRequestStatus,
    @Query('createdBy') createdBy?: string,
    @Query('respondedBy') respondedBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        originCampId?: number;
        destinationCampId?: number;
        status?: IntercampRequestStatus;
        createdBy?: number;
        respondedBy?: number;
        page?: number;
        limit?: number;
      } = {};

      if (originCampId) {
        const parsedOriginCampId = parsePositiveInt(originCampId, 'Invalid originCampId');
        filters.originCampId = parsedOriginCampId;
      }

      if (destinationCampId) {
        const parsedDestinationCampId = parsePositiveInt(destinationCampId, 'Invalid destinationCampId');
        filters.destinationCampId = parsedDestinationCampId;
      }

      if (status) {
        filters.status = status;
      }

      if (createdBy) {
        const parsedCreatedBy = parsePositiveInt(createdBy, 'Invalid createdBy');
        filters.createdBy = parsedCreatedBy;
      }

      if (respondedBy) {
        const parsedRespondedBy = parsePositiveInt(respondedBy, 'Invalid respondedBy');
        filters.respondedBy = parsedRespondedBy;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllRequests(filters);
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
          : 'Error getting intercamp requests',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Intercamp Request' })
  @ApiParam({ name: 'id', type: Number, description: 'Intercamp Request id' })
  @ApiBody({ type: UpdateIntercampRequestDto })
  @ApiOkResponseData(IntercampRequestEntity, { description: 'Intercamp Request updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Intercamp Request not found' })
  async update(@Param('id') id: string, @Body() body: UpdateIntercampRequestDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const request = await this.service.updateRequest(parsedId, body);
      if (!request) throw new NotFoundException('Intercamp request not found');

      return {
        success: true,
        data: request,
        message: 'Intercamp request updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error updating intercamp request',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Intercamp Request' })
  @ApiParam({ name: 'id', type: Number, description: 'Intercamp Request id' })
  @ApiOkResponseMessage({ description: 'Intercamp Request deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Intercamp Request not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteRequest(parsedId);
      if (!deleted) throw new NotFoundException('Intercamp request not found');

      return { success: true, message: 'Intercamp request deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error deleting intercamp request',
      );
    }
  }
}
