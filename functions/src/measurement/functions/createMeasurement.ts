import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { BodyMeasurement } from "../types/measurement.model";
import { CreateMeasurementData } from "../types/measurement.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const createMeasurement = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach' && role !== 'admin' && role !== 'superadmin') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar, adminler ve superadminler tarafından yapılabilir.');
    }

    const data = request.data as CreateMeasurementData;

    if (!data.studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID belirtilmesi zorunludur.');
    }

    try {
        // Verify student exists
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }

        const studentData = studentDoc.data();
        const studentGymId = studentData?.gymId;

        if (!studentGymId) {
            throw new HttpsError('failed-precondition', 'Öğrenci bir spor salonuna atanmamış.');
        }

        // Authorization check
        if (role === 'coach') {
            if (studentData?.coachId !== request.auth.uid) {
                throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
            }
        } else if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            const adminData = adminDoc.data();
            const adminGymIds = adminData?.gymIds || [];

            if (!adminGymIds.includes(studentGymId)) {
                throw new HttpsError('permission-denied', 'Bu öğrencinin spor salonuna erişim yetkiniz yok.');
            }
        }

        const measurementRef = db.collection(COLLECTIONS.MEASUREMENTS).doc();
        const measurementId = measurementRef.id;

        // Calculate BMI if height and weight are provided
        let bmi: number | undefined;
        if (data.height && data.weight) {
            const heightInMeters = data.height / 100;
            bmi = data.weight / (heightInMeters * heightInMeters);
            bmi = Math.round(bmi * 10) / 10; // Round to 1 decimal
        }

        const measurement: BodyMeasurement = {
            id: measurementId,
            studentId: data.studentId,
            coachId: studentData.coachId || '',
            gymId: studentGymId,
            measurementDate: data.measurementDate || admin.firestore.Timestamp.now(),

            height: data.height,
            weight: data.weight,
            shoulders: data.shoulders,
            chest: data.chest,
            arm: data.arm,
            waist: data.waist,
            abdomen: data.abdomen,
            hips: data.hips,
            upperLeg: data.upperLeg,
            calf: data.calf,
            bmi: bmi,
            notes: data.notes,
            createdBy: request.auth.uid,
            createdAt: admin.firestore.Timestamp.now()
        };

        await measurementRef.set(measurement);

        // Log kaydı


        await logActivity({
            action: LogAction.CREATE_MEASUREMENT,
            category: LogCategory.MEASUREMENT,
            performedBy: {
                uid: request.auth!.uid,
                role: role as any,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: measurementId,
                type: 'measurement',
                name: `Ölçüm - ${studentData?.firstName} ${studentData?.lastName}`
            },
            gymId: studentGymId
        });

        return {
            success: true,
            message: "Ölçüm başarıyla kaydedildi.",
            measurementId: measurementId,
            bmi: bmi
        };

    } catch (error: any) {
        console.error("Ölçüm oluşturma hatası:", error);

        await logError({
            functionName: 'createMeasurement',
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
