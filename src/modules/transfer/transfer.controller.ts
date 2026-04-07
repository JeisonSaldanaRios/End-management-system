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


import { ApiBadRequestResponse, ApiBody, ApiNotFoundResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';

import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
  ApiOkResponseMessage,
} from '../../common/swagger/api-response.decorator';
import { parsePositiveInt } from '../../common/validation/request-validation.util';

import { TransferService } from './transfer.service';
import type {
  CreateTransferDTO,
  TransferStatus,
  UpdateTransferDTO,
} from './transfer.model';
import { TransferEntity } from './transfer.entity';

import { CreateTransferDto, UpdateTransferDto } from './dto';
@Controller('transfers')
@ApiTags('Transfer')
export class TransferController {
  constructor(private readonly service: TransferService) {}
  @Post()
  @ApiOperation({ summary: 'Create Transfer' })
  @ApiBody({ type: CreateTransferDto })
  @ApiCreatedResponseData(TransferEntity, { description: 'Transfer created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateTransferDTO) {
    try {
      const transfer = await this.service.createTransfer(body);
      return {
        success: true,
        data: transfer,
        message: 'Transfer created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating transfer',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Transfer by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer id' })
  @ApiOkResponseData(TransferEntity, { description: 'Transfer found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Transfer not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const transfer = await this.service.getTransferById(parsedId);
    if (!transfer) throw new NotFoundException('Transfer not found');

    return { success: true, data: transfer };
  }
  @Get()
  @ApiOperation({ summary: 'List Transfer' })
  @ApiOkResponseList(TransferEntity, { description: 'Transfer list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('requestId') requestId?: string,
    @Query('status') status?: TransferStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        requestId?: number;
        status?: TransferStatus;
        page?: number;
        limit?: number;
      } = {};

      if (requestId) {
        const parsedRequestId = parsePositiveInt(requestId, 'Invalid requestId');
        filters.requestId = parsedRequestId;
      }

      if (status) {
        filters.status = status;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllTransfers(filters);
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
        error instanceof Error ? error.message : 'Error getting transfers',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Transfer' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer id' })
  @ApiBody({ type: UpdateTransferDto })
  @ApiOkResponseData(TransferEntity, { description: 'Transfer updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Transfer not found' })
  async update(@Param('id') id: string, @Body() body: UpdateTransferDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const transfer = await this.service.updateTransfer(parsedId, body);
      if (!transfer) throw new NotFoundException('Transfer not found');

      return {
        success: true,
        data: transfer,
        message: 'Transfer updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating transfer',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Transfer' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer id' })
  @ApiOkResponseMessage({ description: 'Transfer deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Transfer not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteTransfer(parsedId);
      if (!deleted) throw new NotFoundException('Transfer not found');

      return { success: true, message: 'Transfer deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting transfer',
      );
    }
  }
}
