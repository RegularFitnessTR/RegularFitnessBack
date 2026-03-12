import { db, COLLECTIONS } from '../index';

/**
 * Türkçe karakterleri ASCII karşılıklarına dönüştürür
 */
const turkishToAscii = (str: string): string => {
    const map: Record<string, string> = {
        'İ': 'I', 'ı': 'I', 'Ş': 'S', 'ş': 'S',
        'Ğ': 'G', 'ğ': 'G', 'Ü': 'U', 'ü': 'U',
        'Ö': 'O', 'ö': 'O', 'Ç': 'C', 'ç': 'C'
    };
    return str.replace(/[İıŞşĞğÜüÖöÇç]/g, (char) => map[char] || char);
};

/**
 * 8 karakterlik rastgele alfanümerik ID üretir (büyük harf + rakam)
 */
const generateRandomId = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 8; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

/**
 * Gym adından ilk 2 harfi çıkarır (sadece harf olan karakterler)
 * Türkçe karakter desteği ile birlikte
 */
const getNamePrefix = (gymName: string): string => {
    const asciiName = turkishToAscii(gymName);
    const lettersOnly = asciiName.replace(/[^A-Za-z]/g, '');
    return lettersOnly.substring(0, 2).toUpperCase();
};

/**
 * Gym için benzersiz public ID üretir
 * Format: RF-{İLK2HARF}-{8HANE_RANDOM}
 * Örnek: RF-HS-ASD123CX (Harika Spor)
 * 
 * Firestore'da benzersizlik kontrolü yapar, çakışma varsa yeniden üretir
 */
export const generatePublicId = async (gymName: string): Promise<string> => {
    const prefix = getNamePrefix(gymName);

    let publicId: string;
    let isUnique = false;

    do {
        const randomPart = generateRandomId();
        publicId = `RF-${prefix}-${randomPart}`;

        // Firestore'da benzersizlik kontrolü
        const existing = await db.collection(COLLECTIONS.GYMS)
            .where('publicId', '==', publicId)
            .limit(1)
            .get();

        isUnique = existing.empty;
    } while (!isUnique);

    return publicId;
};
