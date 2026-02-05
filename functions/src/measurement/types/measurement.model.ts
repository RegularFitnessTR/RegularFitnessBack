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
    weight?: number;           // Kilo (kg)
    neck?: number;             // Boyun (cm)
    chest?: number;            // Göğüs (cm)
    waist?: number;            // Bel (cm)
    hips?: number;             // Kalça (cm)
    shoulders?: number;        // Omuz (cm)
    bicepsRight?: number;      // Sağ pazı (cm)
    bicepsLeft?: number;       // Sol pazı (cm)
    forearmRight?: number;     // Sağ ön kol (cm)
    forearmLeft?: number;      // Sol ön kol (cm)
    thighRight?: number;       // Sağ uyluk (cm)
    thighLeft?: number;        // Sol uyluk (cm)
    calfRight?: number;        // Sağ baldır (cm)
    calfLeft?: number;         // Sol baldır (cm)

    // Calculated fields
    bmi?: number;              // Body Mass Index
    bodyFatPercentage?: number;

    notes?: string;
    createdBy: string;         // Coach UID
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}
