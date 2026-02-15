import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS } from "../../common";
import { StudentUser } from "../types/student.model";
import { RegisterStudentData } from "../types/student.dto";
import { logActivity } from "../../log/utils/logActivity";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const registerStudent = onCall(async (request) => {
    const data = request.data as RegisterStudentData;

    if (!data.email || !data.password || !data.firstName || !data.lastName) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik bilgi: Email, şifre, ad ve soyad zorunludur.'
        );
    }

    try {
        // 1. Create Firebase Auth user
        const userRecord = await auth.createUser({
            email: data.email,
            password: data.password,
            displayName: `${data.firstName} ${data.lastName}`,
            phoneNumber: data.phoneNumber || undefined,
        });

        // 2. Set custom claims for student role
        await auth.setCustomUserClaims(userRecord.uid, {
            role: 'student',
            student: true
        });

        // 3. Create Firestore document in students collection
        const newStudent: StudentUser = {
            uid: userRecord.uid,
            role: 'student',
            email: data.email,
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber,
            photoUrl: "",
            createdAt: admin.firestore.Timestamp.now(),
            coachId: "" // No coach assigned initially
        };

        await db.collection(COLLECTIONS.STUDENTS).doc(userRecord.uid).set(newStudent);

        // Log kaydı
        await logActivity({
            action: LogAction.REGISTER_STUDENT,
            category: LogCategory.STUDENT,
            performedBy: {
                uid: userRecord.uid,
                role: 'student',
                name: `${data.firstName} ${data.lastName}`
            },
            targetEntity: {
                id: userRecord.uid,
                type: 'student',
                name: `${data.firstName} ${data.lastName}`
            },
            details: { email: data.email }
        });

        return {
            success: true,
            message: "Öğrenci başarıyla oluşturuldu.",
            uid: userRecord.uid
        };

    } catch (error: any) {
        console.error("Kayıt hatası:", error);

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'Kayıt işlemi sırasında bir hata oluştu.');
    }
});
