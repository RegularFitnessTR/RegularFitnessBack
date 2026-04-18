import * as admin from "firebase-admin";
import { db, COLLECTIONS, onCall, HttpsError } from "../../common";
import { ParQTest } from "../types/parq.model";
import { CreateParQTestData } from "../types/parq.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const createParQTest = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
    }

    const data = request.data as CreateParQTestData;

    if (!data.studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    if (!data.questions) {
        throw new HttpsError('invalid-argument', 'ParQ sorularının cevapları belirtilmesi zorunludur.');
    }

    try {
        // Verify student exists
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data();

        // Verify coach is assigned to this student
        if (studentData?.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        const parqRef = db.collection(COLLECTIONS.PARQ_TESTS).doc();
        const parqId = parqRef.id;

        // Calculate results
        const totalYes = Object.values(data.questions).filter(answer => answer === true).length;
        const isPassed = totalYes === 0; // Passes only if all answers are 'no'

        const newParQTest: ParQTest = {
            id: parqId,
            studentId: data.studentId,
            coachId: request.auth.uid,
            testDate: data.testDate || admin.firestore.Timestamp.now(),

            questions: data.questions,

            totalYes: totalYes,
            isPassed: isPassed,

            notes: data.notes,

            createdBy: request.auth.uid,
            createdAt: admin.firestore.Timestamp.now()
        };

        await parqRef.set(newParQTest);

        // Log kaydı
        const coachGymId: string = request.auth!.token.gymId || '';

        await logActivity({
            action: LogAction.CREATE_PARQ_TEST,
            category: LogCategory.PARQ,
            performedBy: {
                uid: request.auth!.uid,
                role: 'coach',
                name: request.auth!.token.name || 'Coach'
            },
            targetEntity: {
                id: parqId,
                type: 'parq',
                name: `ParQ Test - ${studentData?.firstName} ${studentData?.lastName}`
            },
            gymId: coachGymId,
            details: { studentId: data.studentId, isPassed }
        });

        return {
            success: true,
            message: "ParQ testi başarıyla kaydedildi.",
            testId: parqId,
            totalYes: totalYes,
            isPassed: isPassed,
            warning: !isPassed ? "UYARI: Test sonucu olumsuz. Öğrencinin doktor onayı alması önerilir." : undefined
        };

    } catch (error: any) {
        console.error("ParQ testi oluşturma hatası:", error);

        void logError({
            functionName: 'createParQTest',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: { studentId: data.studentId }
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
