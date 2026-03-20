/**
 * Body measurement record for tracking student's physical measurements
 */
export interface BodyMeasurement {
    id: string;
    studentId: string;
    coachId: string;
    measurementDate: FirebaseFirestore.Timestamp;

    // Body measurements (cm unless specified)
    height?: number;           // Boy (cm)
    weight?: number;           // Ağırlık (kg)
    shoulders?: number;        // Omuz (cm)
    chest?: number;            // Göğüs (cm)
    arm?: number;              // Kol (cm)
    waist?: number;            // Bel (cm)
    abdomen?: number;          // Karın (cm)
    hips?: number;             // Kalça (cm)
    upperLeg?: number;         // Üst Bacak (cm)
    calf?: number;             // Kalf (cm)

    // Calculated fields
    bmi?: number;              // Body Mass Index

    notes?: string;
    createdBy: string;         // Coach UID
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}
