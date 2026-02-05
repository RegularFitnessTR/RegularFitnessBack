import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { BodyMeasurement } from "../types/measurement.model";
import { CreateMeasurementData } from "../types/measurement.dto";

export const createMeasurement = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'coach') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece hocalar tarafından yapılabilir.');
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

        // Verify coach is assigned to this student
        if (studentData?.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
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

        const newMeasurement: BodyMeasurement = {
            id: measurementId,
            studentId: data.studentId,
            coachId: request.auth.uid,
            measurementDate: data.measurementDate || admin.firestore.Timestamp.now(),

            height: data.height,
            weight: data.weight,
            neck: data.neck,
            chest: data.chest,
            waist: data.waist,
            hips: data.hips,
            shoulders: data.shoulders,
            bicepsRight: data.bicepsRight,
            bicepsLeft: data.bicepsLeft,
            forearmRight: data.forearmRight,
            forearmLeft: data.forearmLeft,
            thighRight: data.thighRight,
            thighLeft: data.thighLeft,
            calfRight: data.calfRight,
            calfLeft: data.calfLeft,

            bmi: bmi,
            bodyFatPercentage: data.bodyFatPercentage,

            notes: data.notes,
            createdBy: request.auth.uid,
            createdAt: admin.firestore.Timestamp.now()
        };

        await measurementRef.set(newMeasurement);

        return {
            success: true,
            message: "Ölçüm başarıyla kaydedildi.",
            measurementId: measurementId,
            bmi: bmi
        };

    } catch (error: any) {
        console.error("Ölçüm oluşturma hatası:", error);

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
