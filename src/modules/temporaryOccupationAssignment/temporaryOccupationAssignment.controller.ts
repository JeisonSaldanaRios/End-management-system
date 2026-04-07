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


import { TemporaryOccupationAssignmentService } from './temporaryOccupationAssignment.service';
import type {
  CreateTemporaryOccupationAssignmentDTO,
  UpdateTemporaryOccupationAssignmentDTO,
} from './temporaryOccupationAssignment.model';
import { TemporaryOccupationAssignmentEntity } from './temporaryOccupationAssignment.entity';

import { CreateTemporaryOccupationAssignmentDto, UpdateTemporaryOccupationAssignmentDto } from './dto';
@Controller('temporary-occupation-assignments')
@ApiTags('Temporary Occupation Assignment')
export class TemporaryOccupationAssignmentController {
  constructor(private readonly service: TemporaryOccupationAssignmentService) {}
  @Post()
  @ApiOperation({ summary: 'Create Temporary Occupation Assignment' })
  @ApiBody({ type: CreateTemporaryOccupationAssignmentDto })
  @ApiCreatedResponseData(TemporaryOccupationAssignmentEntity, { description: 'Temporary Occupation Assignment created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async create(@Body() body: CreateTemporaryOccupationAssignmentDTO) {
    try {
      const assignment = await this.service.createAssignment(body);
      return {
        success: true,
        data: assignment,
        message: 'Temporary occupation assignment created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error creating temporary occupation assignment',
      );
    }
  }
  @Get(':id')
  @ApiOperation({ summary: 'Get Temporary Occupation Assignment by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Temporary Occupation Assignment id' })
  @ApiOkResponseData(TemporaryOccupationAssignmentEntity, { description: 'Temporary Occupation Assignment found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Temporary Occupation Assignment not found' })
  async getById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const assignment = await this.service.getAssignmentById(parsedId);
    if (!assignment) throw new NotFoundException('Temporary occupation assignment not found');

    return { success: true, data: assignment };
  }
  @Get()
  @ApiOperation({ summary: 'List Temporary Occupation Assignment' })
  @ApiOkResponseList(TemporaryOccupationAssignmentEntity, { description: 'Temporary Occupation Assignment list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  async getAll(
    @Query('personId') personId?: string,
    @Query('temporaryOccupationId') temporaryOccupationId?: string,
    @Query('assignedBy') assignedBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        personId?: number;
        temporaryOccupationId?: number;
        assignedBy?: number;
        page?: number;
        limit?: number;
      } = {};

      if (personId) {
        const parsedPersonId = parsePositiveInt(personId, 'Invalid personId');
        filters.personId = parsedPersonId;
      }

      if (temporaryOccupationId) {
        const parsedTemporaryOccupationId = parsePositiveInt(temporaryOccupationId, 'Invalid temporaryOccupationId');
        filters.temporaryOccupationId = parsedTemporaryOccupationId;
      }

      if (assignedBy) {
        const parsedAssignedBy = parsePositiveInt(assignedBy, 'Invalid assignedBy');
        filters.assignedBy = parsedAssignedBy;
      }

      if (page) {
        filters.page = parsePositiveInt(page, 'Invalid page');
      }

      if (limit) {
        filters.limit = parsePositiveInt(limit, 'Invalid limit');
      }

      const result = await this.service.getAllAssignments(filters);
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
          : 'Error getting temporary occupation assignments',
      );
    }
  }
  @Put(':id')
  @ApiOperation({ summary: 'Update Temporary Occupation Assignment' })
  @ApiParam({ name: 'id', type: Number, description: 'Temporary Occupation Assignment id' })
  @ApiBody({ type: UpdateTemporaryOccupationAssignmentDto })
  @ApiOkResponseData(TemporaryOccupationAssignmentEntity, { description: 'Temporary Occupation Assignment updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiNotFoundResponse({ description: 'Temporary Occupation Assignment not found' })
  async update(@Param('id') id: string, @Body() body: UpdateTemporaryOccupationAssignmentDTO) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const assignment = await this.service.updateAssignment(parsedId, body);
      if (!assignment) {
        throw new NotFoundException('Temporary occupation assignment not found');
      }

      return {
        success: true,
        data: assignment,
        message: 'Temporary occupation assignment updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error updating temporary occupation assignment',
      );
    }
  }
  @Delete(':id')
  @ApiOperation({ summary: 'Delete Temporary Occupation Assignment' })
  @ApiParam({ name: 'id', type: Number, description: 'Temporary Occupation Assignment id' })
  @ApiOkResponseMessage({ description: 'Temporary Occupation Assignment deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Temporary Occupation Assignment not found' })
  async delete(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const deleted = await this.service.deleteAssignment(parsedId);
      if (!deleted) {
        throw new NotFoundException('Temporary occupation assignment not found');
      }

      return {
        success: true,
        message: 'Temporary occupation assignment deleted successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Error deleting temporary occupation assignment',
      );
    }
  }
}
