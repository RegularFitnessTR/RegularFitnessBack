import * as FirebaseFirestore from 'firebase-admin/firestore';

/**
 * Anlık salon varlık kaydı - 'gymPresence' koleksiyonunda saklanır
 */
export interface GymPresenceRecord {
    id: string;
    gymId: string;          // Firestore gym doküman ID'si
    gymPublicId: string;    // QR kodda kullanılan public ID
    userId: string;         // Kullanıcının UID'si
    userRole: 'student' | 'coach';
    firstName: string;
    lastName: string;
    photoUrl?: string;
    checkedInAt: FirebaseFirestore.Timestamp;
    checkedOutAt?: FirebaseFirestore.Timestamp;
    isActive: boolean;      // true = şu an salonda
}
