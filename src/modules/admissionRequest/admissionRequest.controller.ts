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
import {
  assertBooleanValue,
  assertEnumValue,
  assertNonEmptyPayload,
  parsePositiveInt,
  validateStringFieldsMaxLength,
} from '../../common/validation/request-validation.util';

import { AdmissionRequestService } from './admissionRequest.service';
import { AdmissionRequestEntity } from './admissionRequest.entity';
import {
  ADMISSION_REQUEST_STATUS_VALUES,
  type AdmissionRequestStatus,
} from './admissionRequest.model';
import {
  CreateAdmissionRequestDto,
  ProcessAiAdmissionRequestDto,
  ReviewAdmissionRequestDto,
  UpdateAdmissionRequestDto,
} from './dto';

@Controller('admission-requests')
@ApiTags('Admission Requests')
export class AdmissionRequestController {
  constructor(private readonly service: AdmissionRequestService) {}

  private readonly maxLength = {
    name: 15,
    lastName: 15,
    email: 50,
    desiredUsername: 20,
    freeText: 200,
    url: 2048,
    rejectionReason: 100,
  } as const;

  @Post()
  @ApiOperation({ summary: 'Create an admission request' })
  @ApiBody({ type: CreateAdmissionRequestDto })
  @ApiCreatedResponseData(AdmissionRequestEntity, { description: 'Admission request created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  async createRequest(@Body() body: CreateAdmissionRequestDto) {
    validateStringFieldsMaxLength([
      { fieldName: 'name', value: body.name, maxLength: this.maxLength.name, required: true },
      { fieldName: 'lastName1', value: body.lastName1, maxLength: this.maxLength.lastName, required: true },
      { fieldName: 'lastName2', value: body.lastName2, maxLength: this.maxLength.lastName, allowNull: true },
      { fieldName: 'email', value: body.email, maxLength: this.maxLength.email, required: true },
      { fieldName: 'desiredUsername', value: body.desiredUsername, maxLength: this.maxLength.desiredUsername, required: true },
      { fieldName: 'photoUrl', value: body.photoUrl, maxLength: this.maxLength.url, allowNull: true },
      { fieldName: 'declaredHealthLevel', value: body.declaredHealthLevel, maxLength: this.maxLength.freeText, allowNull: true },
      { fieldName: 'previousExperience', value: body.previousExperience, maxLength: this.maxLength.freeText, allowNull: true },
      { fieldName: 'physicalCondition', value: body.physicalCondition, maxLength: this.maxLength.freeText, allowNull: true },
      { fieldName: 'declaredSkills', value: body.declaredSkills, maxLength: this.maxLength.freeText, allowNull: true },
    ]);

    try {
      const request = await this.service.createRequest(body);
      return {
        success: true,
        data: request,
        message: 'Request created successfully',
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Error creating request');
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an admission request by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Admission request not found' })
  async getRequestById(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      const request = await this.service.getRequestById(parsedId);
      return {
        success: true,
        data: request,
      };
    } catch (error) {
      throw new NotFoundException(error instanceof Error ? error.message : 'Request not found');
    }
  }

  @Get()
  @ApiQuery({ name: 'campId', required: false, type: String, description: 'Camp ID' })
  @ApiQuery({ name: 'status', required: false, enum: ADMISSION_REQUEST_STATUS_VALUES, description: 'Request status' })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page (pagination)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page (pagination)' })
  @ApiOperation({ summary: 'List admission requests' })
  @ApiOkResponseList(AdmissionRequestEntity, { description: 'Admission requests list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  async getAllRequests(
    @Query('campId') campId?: string,
    @Query('status') status?: AdmissionRequestStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const filters: {
        campId?: number;
        status?: AdmissionRequestStatus;
        page?: number;
        limit?: number;
      } = {};

      if (campId) {
        const parsedCampId = parsePositiveInt(campId, 'Invalid camp ID');
        filters.campId = parsedCampId;
      }

      if (status) assertEnumValue(status, ADMISSION_REQUEST_STATUS_VALUES, 'Invalid status');

      if (status) filters.status = status;
      if (page) filters.page = parsePositiveInt(page, 'Invalid page');
      if (limit) filters.limit = parsePositiveInt(limit, 'Invalid limit');

      const result = await this.service.getAllRequests(filters);
      const resolvedPage = filters.page || 1;
      const resolvedLimit = filters.limit || 10;

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
      throw new BadRequestException(error instanceof Error ? error.message : 'Error getting requests');
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an admission request' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBody({ type: UpdateAdmissionRequestDto })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  async updateRequest(@Param('id') id: string, @Body() body: UpdateAdmissionRequestDto) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    assertNonEmptyPayload(body);

    validateStringFieldsMaxLength([
      { fieldName: 'name', value: body.name, maxLength: this.maxLength.name },
      { fieldName: 'lastName1', value: body.lastName1, maxLength: this.maxLength.lastName },
      { fieldName: 'lastName2', value: body.lastName2, maxLength: this.maxLength.lastName, allowNull: true },
      { fieldName: 'email', value: body.email, maxLength: this.maxLength.email },
      { fieldName: 'desiredUsername', value: body.desiredUsername, maxLength: this.maxLength.desiredUsername },
      { fieldName: 'photoUrl', value: body.photoUrl, maxLength: this.maxLength.url, allowNull: true },
      { fieldName: 'declaredHealthLevel', value: body.declaredHealthLevel, maxLength: this.maxLength.freeText, allowNull: true },
      { fieldName: 'previousExperience', value: body.previousExperience, maxLength: this.maxLength.freeText, allowNull: true },
      { fieldName: 'physicalCondition', value: body.physicalCondition, maxLength: this.maxLength.freeText, allowNull: true },
      { fieldName: 'declaredSkills', value: body.declaredSkills, maxLength: this.maxLength.freeText, allowNull: true },
    ]);

    try {
      const request = await this.service.updateRequest(parsedId, body);
      return {
        success: true,
        data: request,
        message: 'Request updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Error updating request');
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an admission request' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiOkResponseMessage({ description: 'Admission request deleted' })
  @ApiBadRequestResponse({ description: 'Invalid id or request cannot be deleted' })
  async deleteRequest(@Param('id') id: string) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    try {
      await this.service.deleteRequest(parsedId);
      return {
        success: true,
        message: 'Request deleted successfully',
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Error deleting request');
    }
  }

  @Post(':id/process-ai')
  @ApiOperation({ summary: 'Process an admission request with AI' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBody({ type: ProcessAiAdmissionRequestDto })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request processed by AI' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  async processWithAI(
    @Param('id') id: string,
    @Body() body: ProcessAiAdmissionRequestDto,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const { oficioSugeridoId, decision } = body;

    if (!Number.isInteger(oficioSugeridoId) || oficioSugeridoId < 1) {
      throw new BadRequestException('Invalid oficioSugeridoId');
    }

    assertEnumValue(decision, ['ACCEPT', 'REJECT'] as const, 'Invalid decision');

    try {
      const request = await this.service.processWithAI(parsedId, oficioSugeridoId, decision);
      return {
        success: true,
        data: request,
        message: `Request processed by AI: ${decision}`,
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Error processing with AI');
    }
  }

  @Post(':id/review')
  @ApiOperation({ summary: 'Review an admission request by admin' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBody({ type: ReviewAdmissionRequestDto })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request reviewed by admin' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  async reviewByAdmin(
    @Param('id') id: string,
    @Body() body: ReviewAdmissionRequestDto,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');

    const parsedId = parsePositiveInt(id, 'Invalid ID');

    const { adminUserId, approved, rejectionReason } = body;

    if (!Number.isInteger(adminUserId) || adminUserId < 1) {
      throw new BadRequestException('Invalid adminUserId');
    }

    assertBooleanValue(approved, 'Invalid approved flag');

    if (!approved && (!rejectionReason || !rejectionReason.trim())) {
      throw new BadRequestException('Rejection reason is required when request is rejected');
    }

    validateStringFieldsMaxLength([
      {
        fieldName: 'rejectionReason',
        value: rejectionReason,
        maxLength: this.maxLength.rejectionReason,
      },
    ]);

    try {
      const request = await this.service.reviewByAdmin(
        parsedId,
        adminUserId,
        approved,
        rejectionReason,
      );
      return {
        success: true,
        data: request,
        message: `Request ${approved ? 'approved' : 'rejected'} by admin`,
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Error in admin review');
    }
  }

  @Get('camps/:campId/pending')
  @ApiOperation({ summary: 'List pending admission requests for a camp' })
  @ApiParam({ name: 'campId', type: Number, description: 'Camp id' })
  @ApiOkResponseList(AdmissionRequestEntity, { description: 'Pending admission requests list' })
  @ApiBadRequestResponse({ description: 'Invalid camp id' })
  async getPendingByCamp(@Param('campId') campId: string) {
    if (!campId) throw new BadRequestException('Invalid camp ID');

    const parsedCampId = parsePositiveInt(campId, 'Invalid camp ID');

    try {
      const requests = await this.service.getPendingByCamp(parsedCampId);
      return {
        success: true,
        data: requests,
        count: requests.length,
      };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Error getting pending requests');
    }
  }
}