import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { db, COLLECTIONS } from "../../common";
import { WorkoutSchedule } from "../types/schedule.model";
import { AssignWorkoutScheduleData } from "../types/schedule.dto";
import { validateSessions } from "../utils/validation";
import { PaymentMethodType } from "../../gym/types/gym.enums";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";
import { UserRole } from "../../common/types/base";

export const assignWorkoutSchedule = onCall(async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const { role } = request.auth.token;

    // Klasik salonda öğrenci de kendi programını oluşturabilir
    const allowedRoles = ['coach', 'admin', 'superadmin', 'student'];
    if (!allowedRoles.includes(role)) {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    const data = request.data as AssignWorkoutScheduleData;

    if (!data.studentId) {
        throw new HttpsError('invalid-argument', 'Öğrenci ID zorunludur.');
    }
    if (!data.programName || data.programName.trim().length === 0) {
        throw new HttpsError('invalid-argument', 'Program adı zorunludur.');
    }

    const sessionValidation = validateSessions(data.sessions);
    if (!sessionValidation.valid) {
        throw new HttpsError('invalid-argument', sessionValidation.error || 'Geçersiz seans bilgileri.');
    }

    try {
        // 1. Öğrenciyi getir
        const studentDoc = await db.collection(COLLECTIONS.STUDENTS).doc(data.studentId).get();
        if (!studentDoc.exists) {
            throw new HttpsError('not-found', 'Öğrenci bulunamadı.');
        }
        const studentData = studentDoc.data()!;
        const gymId: string = studentData.gymId;

        if (!gymId) {
            throw new HttpsError('failed-precondition', 'Öğrenci bir salona atanmamış.');
        }

        // 2. Yetki kontrolü
        if (role === 'coach' && studentData.coachId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Bu öğrenci size atanmamış.');
        }

        // Öğrenci sadece kendi programını oluşturabilir
        if (role === 'student' && data.studentId !== request.auth.uid) {
            throw new HttpsError('permission-denied', 'Sadece kendi programınızı oluşturabilirsiniz.');
        }

        if (role === 'admin') {
            const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(request.auth.uid).get();
            const adminGymIds: string[] = adminDoc.data()?.gymIds || [];
            if (!adminGymIds.includes(gymId)) {
                throw new HttpsError('permission-denied', 'Bu öğrencinin salonuna erişim yetkiniz yok.');
            }
        }

        // 3. Salon tipini kontrol et — bu fonksiyon sadece klasik (MEMBERSHIP) salon içindir
        const gymDoc = await db.collection(COLLECTIONS.GYMS).doc(gymId).get();
        if (!gymDoc.exists) {
            throw new HttpsError('not-found', 'Spor salonu bulunamadı.');
        }
        const gymData = gymDoc.data()!;

        if (gymData.paymentMethod?.type === PaymentMethodType.PACKAGE) {
            throw new HttpsError(
                'failed-precondition',
                'Paket bazlı salonlarda haftalık şablon yerine randevu sistemi kullanılmalıdır.'
            );
        }

        // 4. Mevcut aktif program kontrolü
        const existingScheduleQuery = await db.collection(COLLECTIONS.WORKOUT_SCHEDULES)
            .where('studentId', '==', data.studentId)
            .where('isActive', '==', true)
            .get();

        if (!existingScheduleQuery.empty) {
            throw new HttpsError(
                'already-exists',
                'Bu öğrencinin zaten aktif bir çalışma programı var. Önce mevcut programı silin veya pasif yapın.'
            );
        }

        // 5. Programı oluştur
        const scheduleRef = db.collection(COLLECTIONS.WORKOUT_SCHEDULES).doc();
        const scheduleId = scheduleRef.id;

        const newSchedule: WorkoutSchedule = {
            id: scheduleId,
            studentId: data.studentId,
            coachId: studentData.coachId || undefined,
            gymId,
            programName: data.programName.trim(),
            programType: data.programType,
            intensity: data.intensity,
            goal: data.goal,
            sessions: data.sessions,
            isActive: true,
            createdBy: request.auth.uid,
            createdAt: admin.firestore.Timestamp.now()
        };

        await scheduleRef.set(newSchedule);

        await logActivity({
            action: LogAction.ASSIGN_WORKOUT_SCHEDULE,
            category: LogCategory.SCHEDULE,
            performedBy: {
                uid: request.auth!.uid,
                role: role as UserRole,
                name: request.auth!.token.name || role
            },
            targetEntity: {
                id: scheduleId,
                type: 'schedule',
                name: data.programName
            },
            gymId,
            details: { studentId: data.studentId }
        });

        return {
            success: true,
            message: 'Çalışma programı başarıyla oluşturuldu.',
            scheduleId
        };

    } catch (error: any) {
        await logError({
            functionName: 'assignWorkoutSchedule',
            error,
            userId: request.auth?.uid,
            userRole: role,
            requestData: { studentId: data.studentId, programName: data.programName }
        });
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});