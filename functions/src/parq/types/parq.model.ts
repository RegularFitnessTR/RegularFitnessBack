/**
 * ParQ (Physical Activity Readiness Questionnaire) test record
 */
export interface ParQTest {
    id: string;
    studentId: string;
    coachId: string;
    testDate: FirebaseFirestore.Timestamp;

    // 7 standard ParQ yes/no questions
    questions: {
        q1: boolean;  // Has your doctor ever said you have a heart condition?
        q2: boolean;  // Do you feel pain in your chest during physical activity?
        q3: boolean;  // In the past month, have you had chest pain when not doing physical activity?
        q4: boolean;  // Do you lose balance or consciousness?
        q5: boolean;  // Do you have a bone or joint problem that could be made worse by physical activity?
        q6: boolean;  // Is your doctor currently prescribing medication for blood pressure or heart condition?
        q7: boolean;  // Do you know of any other reason you should not engage in physical activity?
    };

    // Results
    totalYes: number;           // Count of 'yes' answers
    isPassed: boolean;          // false if any 'yes' answer

    // Additional info
    notes?: string;
    medicalClearance?: boolean; // Has doctor clearance been obtained?
    clearanceDate?: FirebaseFirestore.Timestamp;

    createdBy: string;          // Coach UID
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}
