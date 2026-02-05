/**
 * Data for creating a new ParQ test
 */
export interface CreateParQTestData {
    studentId: string;
    testDate?: FirebaseFirestore.Timestamp;

    questions: {
        q1: boolean;
        q2: boolean;
        q3: boolean;
        q4: boolean;
        q5: boolean;
        q6: boolean;
        q7: boolean;
    };

    notes?: string;
}

/**
 * Data for updating an existing ParQ test
 */
export interface UpdateParQTestData {
    testId: string;
    medicalClearance?: boolean;
    clearanceDate?: FirebaseFirestore.Timestamp;
    notes?: string;
}
