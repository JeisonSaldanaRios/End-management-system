import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  ApiCreatedResponseData,
  ApiOkResponseData,
  ApiOkResponseList,
} from '../../common/swagger/api-response.decorator';
import { Public, Roles } from '../../common/decorators';
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

const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
const imageUploadOptions = {
  limits: {
    fileSize: MAX_IMAGE_UPLOAD_BYTES,
  },
};

@Controller('admission-requests')
@ApiTags('Admission Requests')
export class AdmissionRequestController {
  constructor(private readonly service: AdmissionRequestService) {}

  private getCurrentUser(req: Request): { userId: number; campId: number; rol: string } {
    const currentUser = req.user as { userId?: number; campId?: number; rol?: string } | undefined;

    if (
      typeof currentUser?.userId !== 'number' ||
      currentUser.userId <= 0 ||
      typeof currentUser.campId !== 'number' ||
      currentUser.campId <= 0 ||
      typeof currentUser.rol !== 'string' ||
      !currentUser.rol
    ) {
      throw new BadRequestException('Authenticated user context is invalid');
    }

    return {
      userId: currentUser.userId,
      campId: currentUser.campId,
      rol: currentUser.rol,
    };
  }

  @Get(':id/ai-features')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Get AI features for admission request' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiOkResponseData(Object, { description: 'AI features' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Request not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getAiFeatures(@Param('id') id: string, @Req() req: Request) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');
    try {
      const currentUser = this.getCurrentUser(req);
      const request = await this.service.getRequestById(parsedId);
      if (request.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      const features = await this.service.getAiFeaturesByRequestId(parsedId);
      return { success: true, data: features };
    } catch (error) {
      throw new NotFoundException(error instanceof Error ? error.message : 'Request not found');
    }
  }

  @Post()
  @Public()
  @ApiOperation({ summary: 'Create an admission request' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        lastName1: { type: 'string' },
        lastName2: { type: 'string', nullable: true },
        email: { type: 'string' },
        desiredUsername: { type: 'string' },
        birthDate: { type: 'string', format: 'date' },
        gender: { type: 'string' },
        declaredHealthLevel: { type: 'string', nullable: true },
        previousExperience: { type: 'string', nullable: true },
        physicalCondition: { type: 'string', nullable: true },
        declaredSkills: { type: 'string', nullable: true },
        campId: { type: 'integer' },
        photo: { type: 'string', format: 'binary' },
      },
      required: ['name', 'lastName1', 'email', 'desiredUsername', 'birthDate', 'gender', 'campId'],
    },
  })
  @ApiCreatedResponseData(AdmissionRequestEntity, { description: 'Admission request created' })
  @ApiBadRequestResponse({ description: 'Invalid payload' })
  @UseInterceptors(FileInterceptor('photo', imageUploadOptions))
  async createRequest(
    @Body() body: CreateAdmissionRequestDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    try {
      if (file) {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
        if (!allowedTypes.includes(file.mimetype)) {
          throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed');
        }

        if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
          throw new BadRequestException('File too large. Maximum size is 5MB');
        }
      }

      const request = await this.service.createRequest(body);
      const resolvedRequest = file
        ? await this.service.uploadAdmissionRequestPhoto(request.id, file)
        : request;

      return {
        success: true,
        data: resolvedRequest,
        message: 'Request created successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error creating request',
      );
    }
  }

  @Get(':id')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Get an admission request by id' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request found' })
  @ApiBadRequestResponse({ description: 'Invalid id' })
  @ApiNotFoundResponse({ description: 'Admission request not found' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getRequestById(@Param('id') id: string, @Req() req: Request) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');
    try {
      const currentUser = this.getCurrentUser(req);
      const request = await this.service.getAdmissionRequestWithSignedUrl(parsedId);
      if (!request || request.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      return { success: true, data: request };
    } catch (error) {
      throw new NotFoundException(error instanceof Error ? error.message : 'Request not found');
    }
  }

  @Get()
  @Roles('SYSTEM_ADMIN')
  @ApiQuery({ name: 'campId', required: false, type: String, description: 'Camp ID' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ADMISSION_REQUEST_STATUS_VALUES,
    description: 'Request status',
  })
  @ApiQuery({ name: 'page', required: false, type: Number, description: 'Page' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Items per page' })
  @ApiOperation({ summary: 'List admission requests' })
  @ApiOkResponseList(AdmissionRequestEntity, { description: 'Admission requests list' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getAllRequests(
    @Query('campId') campId?: string,
    @Query('status') status?: AdmissionRequestStatus,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Req() req?: Request,
  ) {
    try {
      if (!req) {
        throw new BadRequestException('Request context is required');
      }

      const currentUser = this.getCurrentUser(req);
      const filters: {
        campId?: number;
        status?: AdmissionRequestStatus;
        page?: number;
        limit?: number;
      } = {};
      if (campId) {
        const parsedCampId = Number.parseInt(campId, 10);
        if (Number.isNaN(parsedCampId)) throw new BadRequestException('Invalid camp ID');
        if (parsedCampId !== currentUser.campId) {
          throw new BadRequestException('You cannot query requests from another camp');
        }
        filters.campId = parsedCampId;
      } else {
        filters.campId = currentUser.campId;
      }
      if (status) filters.status = status;
      if (page) filters.page = Number.parseInt(page, 10);
      if (limit) filters.limit = Number.parseInt(limit, 10);
      const result = await this.service.getAllAdmissionRequestsWithSignedUrls(filters);
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
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error getting requests',
      );
    }
  }

  @Post(':id/photo')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Upload admission request photo' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Photo uploaded successfully' })
  @ApiBadRequestResponse({ description: 'Invalid id or file' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    if (!file) throw new BadRequestException('No file uploaded');

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed');
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException('File too large. Maximum size is 5MB');
    }

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    try {
      const currentUser = this.getCurrentUser(req);
      const existingRequest = await this.service.getRequestById(parsedId);
      if (!existingRequest || existingRequest.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      const request = await this.service.uploadAdmissionRequestPhoto(parsedId, file);
      return {
        success: true,
        data: request,
        message: 'Photo uploaded successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error uploading photo',
      );
    }
  }

  @Put(':id/photo')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Update admission request photo' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Photo updated successfully' })
  @ApiBadRequestResponse({ description: 'Invalid id or file' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
  async updatePhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    if (!file) throw new BadRequestException('No file uploaded');

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP are allowed');
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      throw new BadRequestException('File too large. Maximum size is 5MB');
    }

    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');

    try {
      const currentUser = this.getCurrentUser(req);
      const existingRequest = await this.service.getRequestById(parsedId);
      if (!existingRequest || existingRequest.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      const request = await this.service.uploadAdmissionRequestPhoto(parsedId, file);
      return {
        success: true,
        data: request,
        message: 'Photo updated successfully',
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating photo',
      );
    }
  }

  @Put(':id')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Update an admission request' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBody({ type: UpdateAdmissionRequestDto })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request updated' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async updateRequest(
    @Param('id') id: string,
    @Body() body: UpdateAdmissionRequestDto,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');
    try {
      const currentUser = this.getCurrentUser(req);
      const existingRequest = await this.service.getRequestById(parsedId);
      if (existingRequest.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      if (body.campId !== undefined && body.campId !== currentUser.campId) {
        throw new BadRequestException('You cannot move requests to another camp');
      }

      const request = await this.service.updateRequest(parsedId, body);
      return { success: true, data: request, message: 'Request updated successfully' };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error updating request',
      );
    }
  }

  @Delete(':id')
  @Roles('NO_ACCESS')
  @ApiOperation({ summary: 'Delete an admission request' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBadRequestResponse({ description: 'Invalid id or request cannot be deleted' })
  async deleteRequest(@Param('id') _id: string) {
    throw new ForbiddenException(
      'Admission requests cannot be deleted. Change status to REJECTED instead for audit purposes.',
    );
  }

  @Post(':id/process-ai')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({
    summary: 'Apply AI recommendation to an admission request',
    description:
      'Records the AI recommendation and moves the request to administrative review. The final approval or rejection is always made by an admin.',
  })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBody({ type: ProcessAiAdmissionRequestDto })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request processed by AI' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async processWithAI(
    @Param('id') id: string,
    @Body() body: ProcessAiAdmissionRequestDto,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');
    const { oficioSugeridoId, decision } = body;
    try {
      const currentUser = this.getCurrentUser(req);
      const existingRequest = await this.service.getRequestById(parsedId);
      if (existingRequest.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      const request = await this.service.processWithAI(parsedId, oficioSugeridoId, decision);
      return {
        success: true,
        data: request,
        message: `AI recommendation recorded: ${decision}. Request pending admin review.`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error processing with AI',
      );
    }
  }

  @Post(':id/review')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'Review an admission request by admin' })
  @ApiParam({ name: 'id', type: Number, description: 'Admission request id' })
  @ApiBody({ type: ReviewAdmissionRequestDto })
  @ApiOkResponseData(AdmissionRequestEntity, { description: 'Admission request reviewed by admin' })
  @ApiBadRequestResponse({ description: 'Invalid id or payload' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async reviewByAdmin(
    @Param('id') id: string,
    @Body() body: ReviewAdmissionRequestDto,
    @Req() req: Request,
  ) {
    if (!id) throw new BadRequestException('Invalid ID');
    const parsedId = Number.parseInt(id, 10);
    if (Number.isNaN(parsedId)) throw new BadRequestException('Invalid ID');
    const { adminUserId, approved, finalOccupationId, finalRole, rejectionReason } = body;
    try {
      const currentUser = this.getCurrentUser(req);
      if (currentUser.userId !== adminUserId) {
        throw new BadRequestException('adminUserId must match the authenticated user');
      }

      const existingRequest = await this.service.getRequestById(parsedId);
      if (existingRequest.campId !== currentUser.campId) {
        throw new NotFoundException('Request not found');
      }

      const request = await this.service.reviewByAdmin(
        parsedId,
        adminUserId,
        approved,
        finalOccupationId,
        finalRole,
        rejectionReason,
      );
      return {
        success: true,
        data: request,
        message: `Request ${approved ? 'approved' : 'rejected'} by admin`,
      };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error in admin review',
      );
    }
  }

  @Get('camps/:campId/pending')
  @Roles('SYSTEM_ADMIN')
  @ApiOperation({ summary: 'List pending admission requests for a camp' })
  @ApiParam({ name: 'campId', type: Number, description: 'Camp id' })
  @ApiOkResponseList(AdmissionRequestEntity, { description: 'Pending admission requests list' })
  @ApiBadRequestResponse({ description: 'Invalid camp id' })
  @ApiUnauthorizedResponse({ description: 'Missing or invalid authentication token' })
  @ApiForbiddenResponse({ description: 'Insufficient permissions' })
  async getPendingByCamp(@Param('campId') campId: string, @Req() req: Request) {
    if (!campId) throw new BadRequestException('Invalid camp ID');
    const parsedCampId = Number.parseInt(campId, 10);
    if (Number.isNaN(parsedCampId)) throw new BadRequestException('Invalid camp ID');
    try {
      const currentUser = this.getCurrentUser(req);
      if (parsedCampId !== currentUser.campId) {
        throw new BadRequestException('You cannot query requests from another camp');
      }

      const requests = await this.service.getPendingByCamp(parsedCampId);
      return { success: true, data: requests, count: requests.length };
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Error getting pending requests',
      );
    }
  }
}
