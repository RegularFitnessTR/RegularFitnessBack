/**
 * Data for creating a new measurement
 */
export interface CreateMeasurementData {
    studentId: string;
    measurementDate?: FirebaseFirestore.Timestamp;

    height?: number;
    weight?: number;
    shoulders?: number;
    chest?: number;
    arm?: number;
    waist?: number;
    abdomen?: number;
    hips?: number;
    upperLeg?: number;
    calf?: number;
    notes?: string;
}

/**
 * Data for updating an existing measurement
 */
export interface UpdateMeasurementData {
    measurementId: string;

    height?: number;
    weight?: number;
    shoulders?: number;
    chest?: number;
    arm?: number;
    waist?: number;
    abdomen?: number;
    hips?: number;
    upperLeg?: number;
    calf?: number;
    notes?: string;
}
