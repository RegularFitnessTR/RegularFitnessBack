// Constants
export * from './constants/collections';

// Types
export * from './types/base';

// Core utils (her fonksiyonun ihtiyaç duyduğu hafif yardımcılar)
export * from './utils/firebase';
export * from './utils/rateLimit';
export * from './utils/onCall';
export * from './utils/serialize';

// NOT: Aşağıdakiler barrel'dan kasten çıkarıldı (cold start optimizasyonu) —
// kullanıldıkları dosyalarda doğrudan import edilmeli:
//   - './utils/qrcode'          → sadece coach register/create kullanır
//   - './utils/syncGymClaims'   → sadece gym/coach/admin custom claims işlemleri
//   - './functions/getMyProfile' → ayrı fonksiyon modülü
//   - './functions/ping'         → ayrı fonksiyon modülü
