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


import { TransferHistoryService } from './transferHistory.service';
import type {
  CreateTransferHistoryDTO,
  UpdateTransferHistoryDTO,
} from './transferHistory.model';
import type { TransferStatus } from '../transfer/transfer.model';
import { TransferHistoryEntity } from './transferHistory.entity';

import { CreateTransferHistoryDto, UpdateTransferHistoryDto } from './dto';
@Controller('transfer-history')
@ApiTags('Transfer History')
export class TransferHistoryController {
  constructor(private readonly service: TransferHistoryService) {}
  @Post()
  @ApiOperation({ summary: 'Create Transfer History' })
  @ApiBody({ type: CreateTransferHistoryDto })
  @ApiCreatedResponseData(TransferHistoryEntity, { description: 'Transfer History created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateTransferHistoryDTO) {
    try {
      const entry = await this.service.createEntry(body);
      return {
        success: true,
        data: entry,
        message: 'Transfer history entry created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating transfer history entry',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Transfer History by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer History id' })
  @ApiOkResponseData(TransferHistoryEntity, { description: 'Transfer History found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Transfer History not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const entry = await this.service.getEntryById(parsedId);
    if (!entry) throw new NotFoundException('Transfer history entry not found');

    return { success: true, data: entry };
  }
  @Get()
  @ApiOperation({ summary: 'List Transfer History' })
  @ApiOkResponseList(TransferHistoryEntity, { description: 'Transfer History list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('transferId') transferId?: string,
    @Query('userId') userId?: string,
    @Query('previousStatus') previousStatus?: TransferStatus,
    @Query('newStatus') newStatus?: TransferStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: any,
  ) {
    try {
      const filters: {
        transferId?: number;
        userId?: number;
        previousStatus?: TransferStatus;
        newStatus?: TransferStatus;
        page?: number;
        limit?: number;
      } = {};

      if (transferId) {
        const parsedTransferId = parsePositiveInt(transferId, 'Invalid transferId');
        filters.transferId = parsedTransferId;
      }

      if (userId) {
        const parsedUserId = parsePositiveInt(userId, 'Invalid userId');
        filters.userId = parsedUserId;
      }

      if (previousStatus) {
        filters.previousStatus = previousStatus;
      }

      if (newStatus) {
        filters.newStatus = newStatus;
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
        error instanceof Error ? error.message : 'Error getting transfer history',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Transfer History' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer History id' })
  @ApiBody({ type: UpdateTransferHistoryDto })
  @ApiOkResponseData(TransferHistoryEntity, { description: 'Transfer History updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Transfer History not found' })
  async update(@Param('id') id: string, @Body() body: UpdateTransferHistoryDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const entry = await this.service.updateEntry(parsedId, body);
      if (!entry) throw new NotFoundException('Transfer history entry not found');

      return {
        success: true,
        data: entry,
        message: 'Transfer history entry updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating transfer history entry',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Transfer History' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer History id' })
  @ApiOkResponseMessage({ description: 'Transfer History deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Transfer History not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteEntry(parsedId);
      if (!deleted) throw new NotFoundException('Transfer history entry not found');

      return { success: true, message: 'Transfer history entry deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting transfer history entry',
      );
    }
  }
}
