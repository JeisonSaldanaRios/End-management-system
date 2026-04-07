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

import { AccessLogService } from './accessLog.service';
import type {
  AccessLogEventType,
  CreateAccessLogDTO,
  UpdateAccessLogDTO,
} from './accessLog.model';
import { ACCESS_LOG_EVENT_TYPE_VALUES } from './accessLog.model';
import { AccessLogEntity } from './accessLog.entity';

import { CreateAccessLogDto, UpdateAccessLogDto } from './dto';
@Controller('access-logs')
@ApiTags('Access Log')
export class AccessLogController {
  constructor(private readonly service: AccessLogService) {}
  @Post()
  @ApiOperation({ summary: 'Create Access Log' })
  @ApiBody({ type: CreateAccessLogDto })
  @ApiCreatedResponseData(AccessLogEntity, { description: 'Access Log created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateAccessLogDTO) {
    validateStringFieldsMaxLength([
      { fieldName: 'sourceIp', value: body.sourceIp, maxLength: COMMON_MAX_LENGTH.ip, allowNull: true },
      { fieldName: 'detail', value: body.detail, maxLength: COMMON_MAX_LENGTH.longText, allowNull: true },
    ]);

    try {
      const log = await this.service.createLog(body);
      return {
        success: true,
        data: log,
        message: 'Access log created successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating access log',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Access Log by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Access Log id' })
  @ApiOkResponseData(AccessLogEntity, { description: 'Access Log found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Access Log not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const log = await this.service.getLogById(parsedId);
    if (!log) throw new NotFoundException('Access log not found');

    return { success: true, data: log };
  }
  @Get()
  @ApiOperation({ summary: 'List Access Log' })
  @ApiOkResponseList(AccessLogEntity, { description: 'Access Log list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('userId') userId?: string,
    @Query('campId') campId?: string,
    @Query('sessionId') sessionId?: string,
    @Query('eventType') eventType?: AccessLogEventType,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        userId?: number;
        campId?: number;
        sessionId?: number;
        eventType?: AccessLogEventType;
        page?: number;
        limit?: number;
      } = {};

      if (userId) {
        const parsedUserId = parsePositiveInt(userId, 'Invalid userId');
        filters.userId = parsedUserId;
      }

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid campId');
        filters.campId = parsedCampId;
      }

      if (sessionId) {
        const parsedSessionId = parsePositiveInt(sessionId, 'Invalid sessionId');
        filters.sessionId = parsedSessionId;
      }

      if (eventType) {
        assertEnumValue(eventType, ACCESS_LOG_EVENT_TYPE_VALUES, 'Invalid eventType');
        filters.eventType = eventType;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllLogs(filters);
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
        error instanceof Error ? error.message : 'Error getting access logs',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Access Log' })
  @ApiParam({ name: 'id', type: Number, description: 'Access Log id' })
  @ApiBody({ type: UpdateAccessLogDto })
  @ApiOkResponseData(AccessLogEntity, { description: 'Access Log updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Access Log not found' })
  async update(@Param('id') id: string, @Body() body: UpdateAccessLogDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    assertNonEmptyPayload(body);

    validateStringFieldsMaxLength([
      { fieldName: 'sourceIp', value: body.sourceIp, maxLength: COMMON_MAX_LENGTH.ip, allowNull: true },
      { fieldName: 'detail', value: body.detail, maxLength: COMMON_MAX_LENGTH.longText, allowNull: true },
    ]);

    try {
      const log = await this.service.updateLog(parsedId, body);
      if (!log) throw new NotFoundException('Access log not found');

      return {
        success: true,
        data: log,
        message: 'Access log updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating access log',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Access Log' })
  @ApiParam({ name: 'id', type: Number, description: 'Access Log id' })
  @ApiOkResponseMessage({ description: 'Access Log deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Access Log not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteLog(parsedId);
      if (!deleted) throw new NotFoundException('Access log not found');

      return { success: true, message: 'Access log deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting access log',
      );
    }
  }
}
