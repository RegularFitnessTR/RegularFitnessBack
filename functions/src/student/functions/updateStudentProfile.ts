import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth, COLLECTIONS } from "../../common";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UpdateStudentProfileData } from "../types/student.dto";

export const updateStudentProfile = onCall(async (request) => {
    // Student updates their own profile
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;
    if (role !== 'student') {
        throw new HttpsError('permission-denied', 'Bu işlem sadece öğrenciler tarafından yapılabilir.');
    }

    const studentUid = request.auth.uid;
    const data = request.data as UpdateStudentProfileData;

    try {
        // Verify student exists
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(studentUid).get();

        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci kaydı bulunamadı.');
        }

        const studentData = studentDoc.data();

        // Firebase Auth updates
        const authUpdates: any = {};

        if (data.firstName || data.lastName) {
            const firstName = data.firstName || studentData?.firstName;
            const lastName = data.lastName || studentData?.lastName;
            authUpdates.displayName = `${firstName} ${lastName}`;
        }

        if (data.phoneNumber !== undefined) {
            authUpdates.phoneNumber = data.phoneNumber || null;
        }

        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(studentUid, authUpdates);
        }

        // Firestore updates
        const firestoreUpdates: any = {};

        if (data.firstName) firestoreUpdates.firstName = data.firstName;
        if (data.lastName) firestoreUpdates.lastName = data.lastName;
        if (data.phoneNumber !== undefined) firestoreUpdates.phoneNumber = data.phoneNumber;
        if (data.gender !== undefined) firestoreUpdates.gender = data.gender;
        if (data.medicalConditions !== undefined) firestoreUpdates.medicalConditions = data.medicalConditions;
        if (data.birthDate !== undefined) firestoreUpdates.birthDate = data.birthDate;

        if (Object.keys(firestoreUpdates).length > 0) {
            await db.collection(COLLECTIONS.STUDENTS).doc(studentUid).update(firestoreUpdates);
        }

        // Log kaydı
        await logActivity({
            action: LogAction.UPDATE_STUDENT_PROFILE,
            category: LogCategory.STUDENT,
            performedBy: {
                uid: studentUid,
                role: 'student',
                name: `${studentData?.firstName} ${studentData?.lastName}`
            },
            targetEntity: {
                id: studentUid,
                type: 'student',
                name: `${studentData?.firstName} ${studentData?.lastName}`
            },
            gymId: studentData?.gymId || undefined,
            details: { updatedFields: Object.keys(firestoreUpdates) }
        });

        return {
            success: true,
            message: "Profiliniz başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Öğrenci profil güncelleme hatası:", error);

        await logError({
            functionName: 'updateStudentProfile',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
