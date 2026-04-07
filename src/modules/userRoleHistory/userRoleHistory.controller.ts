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


import { UserRoleHistoryService } from './userRoleHistory.service';
import type {
  CreateUserRoleHistoryDTO,
  UpdateUserRoleHistoryDTO,
} from './userRoleHistory.model';
import { UserRoleHistoryEntity } from './userRoleHistory.entity';

import { CreateUserRoleHistoryDto, UpdateUserRoleHistoryDto } from './dto';
@Controller('user-role-history')
@ApiTags('User Role History')
export class UserRoleHistoryController {
  constructor(private readonly service: UserRoleHistoryService) {}
  @Post()
  @ApiOperation({ summary: 'Create User Role History' })
  @ApiBody({ type: CreateUserRoleHistoryDto })
  @ApiCreatedResponseData(UserRoleHistoryEntity, { description: 'User Role History created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateUserRoleHistoryDTO) {
    try {
      const entry = await this.service.createEntry(body);
      return {
        success: true,
        data: entry,
        message: 'User role history entry created successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating user role history entry',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get User Role History by id' })
  @ApiParam({ name: 'id', type: Number, description: 'User Role History id' })
  @ApiOkResponseData(UserRoleHistoryEntity, { description: 'User Role History found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'User Role History not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const entry = await this.service.getEntryById(parsedId);
    if (!entry) throw new NotFoundException('User role history entry not found');

    return { success: true, data: entry };
  }
  @Get()
  @ApiOperation({ summary: 'List User Role History' })
  @ApiOkResponseList(UserRoleHistoryEntity, { description: 'User Role History list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('userId') userId?: string,
    @Query('changedBy') changedBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        userId?: number;
        changedBy?: number;
        page?: number;
        limit?: number;
      } = {};

      if (userId) {
        const parsedUserId = parsePositiveInt(userId, 'Invalid userId');
        filters.userId = parsedUserId;
      }

      if (changedBy) {
        const parsedChangedBy = parsePositiveInt(changedBy, 'Invalid changedBy');
        filters.changedBy = parsedChangedBy;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllEntries(filters);
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
        error instanceof Error ? error.message : 'Error getting user role history',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update User Role History' })
  @ApiParam({ name: 'id', type: Number, description: 'User Role History id' })
  @ApiBody({ type: UpdateUserRoleHistoryDto })
  @ApiOkResponseData(UserRoleHistoryEntity, { description: 'User Role History updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'User Role History not found' })
  async update(@Param('id') id: string, @Body() body: UpdateUserRoleHistoryDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const entry = await this.service.updateEntry(parsedId, body);
      if (!entry) throw new NotFoundException('User role history entry not found');

      return {
        success: true,
        data: entry,
        message: 'User role history entry updated successfully',
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating user role history entry',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete User Role History' })
  @ApiParam({ name: 'id', type: Number, description: 'User Role History id' })
  @ApiOkResponseMessage({ description: 'User Role History deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'User Role History not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteEntry(parsedId);
      if (!deleted) throw new NotFoundException('User role history entry not found');

      return { success: true, message: 'User role history entry deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting user role history entry',
      );
    }
  }
}
