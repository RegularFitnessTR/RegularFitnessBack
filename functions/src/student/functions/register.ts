import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS } from "../../common";
import { StudentUser } from "../types/student.model";
import { RegisterStudentData } from "../types/student.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const registerStudent = onCall(async (request) => {
    const data = request.data as RegisterStudentData;

    if (!data.email || !data.password || !data.firstName || !data.lastName || !data.gender || !data.birthDate) {
        throw new HttpsError(
            'invalid-argument',
            'Eksik bilgi: Email, şifre, ad, soyad, cinsiyet ve doğum tarihi zorunludur.'
        );
    }

    // Validate gender value
    const validGenders = ['male', 'female', 'other'];
    if (!validGenders.includes(data.gender)) {
        throw new HttpsError(
            'invalid-argument',
            'Geçersiz cinsiyet değeri. male, female veya other olmalıdır.'
        );
    }

    // Parse birthDate
    let birthDateTimestamp: admin.firestore.Timestamp;
    if (typeof data.birthDate === 'number') {
        const ms = data.birthDate > 9999999999 ? data.birthDate : data.birthDate * 1000;
        birthDateTimestamp = admin.firestore.Timestamp.fromMillis(ms);
    } else if (typeof data.birthDate === 'string') {
        const birthDateParsed = new Date(data.birthDate);
        if (isNaN(birthDateParsed.getTime())) {
            throw new HttpsError('invalid-argument', 'Geçersiz doğum tarihi formatı.');
        }
        birthDateTimestamp = admin.firestore.Timestamp.fromDate(birthDateParsed);
    } else if (data.birthDate && typeof data.birthDate === 'object') {
        if ('_seconds' in data.birthDate) {
            birthDateTimestamp = new admin.firestore.Timestamp(data.birthDate._seconds, data.birthDate._nanoseconds || 0);
        } else if ('seconds' in data.birthDate) {
            birthDateTimestamp = new admin.firestore.Timestamp(data.birthDate.seconds, data.birthDate.nanoseconds || 0);
        } else {
            throw new HttpsError('invalid-argument', 'Desteklenmeyen doğum tarihi obje formatı.');
        }
    } else {
        throw new HttpsError('invalid-argument', 'Geçersiz doğum tarihi.');
    }

    // Gym public ID verilmişse, gym'i doğrula
    let resolvedGymId = "";
    let resolvedGymName = "";
    if (data.gymPublicId) {
        const gymSnapshot = await db.collection(COLLECTIONS.GYMS)
            .where('publicId', '==', data.gymPublicId)
            .limit(1)
            .get();

        if (gymSnapshot.empty) {
            throw new HttpsError(
                'not-found',
                'Belirtilen salon kodu bulunamadı. Lütfen kodu kontrol ediniz.'
            );
        }

        resolvedGymId = gymSnapshot.docs[0].id;
        resolvedGymName = gymSnapshot.docs[0].data()?.name || "";
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
            gender: data.gender,
            birthDate: birthDateTimestamp,
            createdAt: admin.firestore.Timestamp.now(),
            gymId: resolvedGymId,  // Empty string if no gym provided
            coachId: "" // No coach assigned initially
        };

        await db.collection(COLLECTIONS.STUDENTS).doc(userRecord.uid).set(newStudent);

        // Öğrenci ancak bir gym'e bağlı ise loglanır.
        if (resolvedGymId) {
            await logActivity({
                action: LogAction.JOIN_GYM,
                category: LogCategory.STUDENT,
                performedBy: {
                    uid: userRecord.uid,
                    role: 'student',
                    name: `${data.firstName} ${data.lastName}`
                },
                targetEntity: {
                    id: resolvedGymId,
                    type: 'gym',
                    name: resolvedGymName
                },
                gymId: resolvedGymId,
                details: {
                    source: 'register',
                    studentId: userRecord.uid,
                    email: data.email
                }
            });
        }

        return {
            success: true,
            message: "Öğrenci başarıyla oluşturuldu.",
            uid: userRecord.uid
        };

    } catch (error: any) {
        console.error("Kayıt hatası:", error);

        await logError({
            functionName: 'registerStudent',
            error,
            requestData: data
        });

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'Kayıt işlemi sırasında bir hata oluştu.');
    }
});
