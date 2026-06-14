export interface TemporaryOccupationAssignment {
  id: number;
  personId: number;
  temporaryOccupationId: number;
  startDate: Date;
  endDate: Date | null;
  reason: string;
  assignedBy: number;
  status?: 'ACTIVA' | 'FINALIZADA';
}

export interface CreateTemporaryOccupationAssignmentDTO {
  personId: number;
  temporaryOccupationId: number;
  startDate?: Date;
  endDate?: Date | null;
  reason: string;
  assignedBy: number;
}

export interface UpdateTemporaryOccupationAssignmentDTO {
  personId?: number;
  temporaryOccupationId?: number;
  startDate?: Date;
  endDate?: Date | null;
  reason?: string;
  assignedBy?: number;
}
