import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

export const resetPassword = onCall(async (request) => {
    // Check if user is authenticated
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'User must be logged in to reset password.');
    }

    const uid = request.auth.uid;
    const { newPassword } = request.data;

    if (!newPassword || newPassword.length < 6) {
         throw new HttpsError('invalid-argument', 'Password must be at least 6 characters long.');
    }

    try {
        await admin.auth().updateUser(uid, {
            password: newPassword
        });
        return { success: true, message: 'Şifreniz başarıyla güncellendi.' };
    } catch (error) {
        console.error('Error updating password:', error);
        throw new HttpsError('internal', 'Şifre güncellenirken bir hata oluştu.');
    }
});
