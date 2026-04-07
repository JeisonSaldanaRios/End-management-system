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


import { TransferPersonService } from './transferPerson.service';
import type {
  CreateTransferPersonDTO,
  PersonTransferStatus,
  UpdateTransferPersonDTO,
} from './transferPerson.model';
import { TransferPersonEntity } from './transferPerson.entity';

import { CreateTransferPersonDto, UpdateTransferPersonDto } from './dto';
@Controller('transfer-persons')
@ApiTags('Transfer Person')
export class TransferPersonController {
  constructor(private readonly service: TransferPersonService) {}
  @Post()
  @ApiOperation({ summary: 'Create Transfer Person' })
  @ApiBody({ type: CreateTransferPersonDto })
  @ApiCreatedResponseData(TransferPersonEntity, { description: 'Transfer Person created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateTransferPersonDTO) {
    try {
      const transferPerson = await this.service.createTransferPerson(body);
      return {
        success: true,
        data: transferPerson,
        message: 'Transfer person created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating transfer person',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Transfer Person by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer Person id' })
  @ApiOkResponseData(TransferPersonEntity, { description: 'Transfer Person found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Transfer Person not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const transferPerson = await this.service.getTransferPersonById(parsedId);
    if (!transferPerson) throw new NotFoundException('Transfer person not found');

    return { success: true, data: transferPerson };
  }
  @Get()
  @ApiOperation({ summary: 'List Transfer Person' })
  @ApiOkResponseList(TransferPersonEntity, { description: 'Transfer Person list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('transferId') transferId?: string,
    @Query('personId') personId?: string,
    @Query('status') status?: PersonTransferStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        transferId?: number;
        personId?: number;
        status?: PersonTransferStatus;
        page?: number;
        limit?: number;
      } = {};

      if (transferId) {
        const parsedTransferId = parsePositiveInt(transferId, 'Invalid transferId');
        filters.transferId = parsedTransferId;
      }

      if (personId) {
        const parsedPersonId = parsePositiveInt(personId, 'Invalid personId');
        filters.personId = parsedPersonId;
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

      const result = await this.service.getAllTransferPeople(filters);
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
        error instanceof Error ? error.message : 'Error getting transfer people',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Transfer Person' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer Person id' })
  @ApiBody({ type: UpdateTransferPersonDto })
  @ApiOkResponseData(TransferPersonEntity, { description: 'Transfer Person updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Transfer Person not found' })
  async update(@Param('id') id: string, @Body() body: UpdateTransferPersonDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const transferPerson = await this.service.updateTransferPerson(parsedId, body);
      if (!transferPerson) throw new NotFoundException('Transfer person not found');

      return {
        success: true,
        data: transferPerson,
        message: 'Transfer person updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating transfer person',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Transfer Person' })
  @ApiParam({ name: 'id', type: Number, description: 'Transfer Person id' })
  @ApiOkResponseMessage({ description: 'Transfer Person deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Transfer Person not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteTransferPerson(parsedId);
      if (!deleted) throw new NotFoundException('Transfer person not found');

      return { success: true, message: 'Transfer person deleted successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error deleting transfer person',
      );
    }
  }
}
