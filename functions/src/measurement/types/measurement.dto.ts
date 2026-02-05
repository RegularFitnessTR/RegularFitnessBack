/**
 * Data for creating a new measurement
 */
export interface CreateMeasurementData {
    studentId: string;
    measurementDate?: FirebaseFirestore.Timestamp;

    height?: number;
    weight?: number;
    neck?: number;
    chest?: number;
    waist?: number;
    hips?: number;
    shoulders?: number;
    bicepsRight?: number;
    bicepsLeft?: number;
    forearmRight?: number;
    forearmLeft?: number;
    thighRight?: number;
    thighLeft?: number;
    calfRight?: number;
    calfLeft?: number;
    bodyFatPercentage?: number;
    notes?: string;
}

/**
 * Data for updating an existing measurement
 */
export interface UpdateMeasurementData {
    measurementId: string;

    height?: number;
    weight?: number;
    neck?: number;
    chest?: number;
    waist?: number;
    hips?: number;
    shoulders?: number;
    bicepsRight?: number;
    bicepsLeft?: number;
    forearmRight?: number;
    forearmLeft?: number;
    thighRight?: number;
    thighLeft?: number;
    calfRight?: number;
    calfLeft?: number;
    bodyFatPercentage?: number;
    notes?: string;
}
