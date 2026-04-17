import * as admin from "firebase-admin";
import { db, auth, COLLECTIONS, syncGymClaims, onCall, HttpsError } from "../../common";
import { UpdateAdminData } from "../types/admin.dto";
import { logActivity } from "../../log/utils/logActivity";
import { logError } from "../../log/utils/logError";
import { LogAction, LogCategory } from "../../log/types/log.enums";

export const updateAdmin = onCall(async (request) => {
    // 1. Yetki Kontrolü: İsteği yapan kişi Superadmin mi yoksa kendisi mi?
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Bu işlem için giriş yapmalısınız.');
    }

    const data = request.data as UpdateAdminData;

    if (!data.adminUid) {
        throw new HttpsError(
            'invalid-argument',
            'Admin UID belirtilmesi zorunludur.'
        );
    }

    const isSuperAdmin = request.auth.token.role === 'superadmin' || !!request.auth.token.superadmin;
    const isUpdatingSelf = request.auth.uid === data.adminUid;

    if (!isSuperAdmin && !isUpdatingSelf) {
        throw new HttpsError('permission-denied', 'Bu işlem için yetkiniz yok.');
    }

    // Admin kendi gym yetkilerini değiştiremez, sadece Superadmin yapabilir.
    if (!isSuperAdmin && (data.gymIds !== undefined || data.addGymIds !== undefined || data.removeGymIds !== undefined)) {
        throw new HttpsError('permission-denied', 'Kendi gym yetkilerinizi değiştiremezsiniz. Bu işlem için Superadmin ile iletişime geçiniz.');
    }

    const hasReplaceGymIds = data.gymIds !== undefined;
    const hasAddGymIds = (data.addGymIds?.length || 0) > 0;
    const hasRemoveGymIds = (data.removeGymIds?.length || 0) > 0;

    if (hasReplaceGymIds && (hasAddGymIds || hasRemoveGymIds)) {
        throw new HttpsError('invalid-argument', 'gymIds ile addGymIds/removeGymIds aynı istekte kullanılamaz.');
    }

    if (hasAddGymIds && hasRemoveGymIds) {
        throw new HttpsError('invalid-argument', 'addGymIds ve removeGymIds aynı istekte kullanılamaz.');
    }

    try {
        // 2. Query from admins collection
        const adminDoc = await db.collection(COLLECTIONS.ADMINS).doc(data.adminUid).get();

        if (!adminDoc.exists) {
            throw new HttpsError('not-found', 'Admin kullanıcısı bulunamadı.');
        }

        const adminData = adminDoc.data();

        // Verify it's actually an admin
        if (adminData?.role !== 'admin') {
            throw new HttpsError(
                'permission-denied',
                'Bu kullanıcı bir admin değil, dolayısıyla güncellenemez.'
            );
        }

        // 3. Firebase Auth güncellemeleri
        const authUpdates: any = {};

        if (data.email) {
            authUpdates.email = data.email;
        }

        if (data.firstName || data.lastName) {
            const firstName = data.firstName || adminData.firstName;
            const lastName = data.lastName || adminData.lastName;
            authUpdates.displayName = `${firstName} ${lastName}`;
        }

        if (data.phoneNumber !== undefined) {
            authUpdates.phoneNumber = data.phoneNumber || null;
        }

        if (data.photoUrl) {
            authUpdates.photoURL = data.photoUrl;
        }

        // Auth güncellemesi varsa uygula
        if (Object.keys(authUpdates).length > 0) {
            await auth.updateUser(data.adminUid, authUpdates);
        }

        // 4. Firestore güncellemeleri in admins collection
        const firestoreUpdates: any = {};

        if (data.firstName) {
            firestoreUpdates.firstName = data.firstName;
        }

        if (data.lastName) {
            firestoreUpdates.lastName = data.lastName;
        }

        if (data.phoneNumber !== undefined) {
            firestoreUpdates.phoneNumber = data.phoneNumber;
        }

        if (data.email) {
            firestoreUpdates.email = data.email;
        }

        if (data.photoUrl) {
            firestoreUpdates.photoUrl = data.photoUrl;
        }

        // GymIds management - three modes (mutually exclusive for gymIds field):
        // 1. Replace all gymIds
        if (hasReplaceGymIds) {
            firestoreUpdates.gymIds = data.gymIds;
            // 2. Add specific gymIds (using arrayUnion)
        } else if (hasAddGymIds) {
            firestoreUpdates.gymIds = admin.firestore.FieldValue.arrayUnion(...data.addGymIds!);
            // 3. Remove specific gymIds (using arrayRemove)
        } else if (hasRemoveGymIds) {
            firestoreUpdates.gymIds = admin.firestore.FieldValue.arrayRemove(...data.removeGymIds!);
        }

        firestoreUpdates.updatedAt = admin.firestore.Timestamp.now();

        // Firestore güncellemesi varsa uygula
        if (Object.keys(firestoreUpdates).length > 0) {
            await db.collection(COLLECTIONS.ADMINS).doc(data.adminUid).update(firestoreUpdates);
        }

        // gymIds değiştiyse custom claims'i de güncelle
        if (hasReplaceGymIds || hasAddGymIds || hasRemoveGymIds) {
            const updatedDoc = await db.collection(COLLECTIONS.ADMINS).doc(data.adminUid).get();
            const newGymIds: string[] = updatedDoc.data()?.gymIds || [];
            await syncGymClaims(data.adminUid, { gymIds: newGymIds });
        }

        // Log kaydı
        await logActivity({
            action: LogAction.UPDATE_ADMIN,
            category: LogCategory.ADMIN,
            performedBy: {
                uid: request.auth!.uid,
                role: isSuperAdmin ? 'superadmin' : 'admin',
                name: request.auth!.token.name || (isSuperAdmin ? 'SuperAdmin' : 'Admin')
            },
            targetEntity: {
                id: data.adminUid,
                type: 'admin',
                name: `${adminData?.firstName} ${adminData?.lastName}`
            },
            details: { updatedFields: Object.keys(firestoreUpdates) }
        });

        return {
            success: true,
            message: "Admin başarıyla güncellendi."
        };

    } catch (error: any) {
        console.error("Admin güncelleme hatası:", error);

        await logError({
            functionName: 'updateAdmin',
            error,
            userId: request.auth?.uid,
            userRole: request.auth?.token?.role,
            requestData: data
        });

        if (error instanceof HttpsError) {
            throw error;
        }

        if (error.code === 'auth/user-not-found') {
            throw new HttpsError('not-found', 'Admin kullanıcısı bulunamadı.');
        }

        if (error.code === 'auth/email-already-exists') {
            throw new HttpsError('already-exists', 'Bu email adresi zaten kullanımda.');
        }

        throw new HttpsError('internal', 'İşlem sırasında bir hata oluştu.');
    }
});
