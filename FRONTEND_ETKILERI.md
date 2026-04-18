# Frontend Etkileri (iOS / Web)

> Backend optimizasyon değişikliklerinin **frontend tarafında** gerektireceği güncellemelerin kayıt defteri.
> Her backend maddesi tamamlandığında, ilgili etkiler buraya eklenir.
>
> **iOS uygulaması ve admin web (Vite+React) için referans dosyadır.**
> **Son güncelleme:** 2026-04-18

## Etki Lejantı
- 🔴 **Breaking** — frontend güncellemesi YAPILMAZSA bozulur
- 🟡 **Davranışsal** — eski kod çalışır ama yeni davranıştan faydalanmak için güncelleme önerilir
- 🟢 **Performans** — frontend tarafında ek bir şey gerekmez, sadece hızlanır
- ℹ️ **Bilgi** — sadece farkındalık için (test edilirken görülebilecek değişiklikler)

---

## Tamamlanan Değişiklikler

### K1 — Middleware Firestore okuması kaldırıldı
**Tarih:** 2026-04-18
**Backend dosyası:** `functions/src/common/utils/onCall.ts`

#### 🔴 Breaking — Token Refresh Zorunluluğu
**Etkilenen senaryolar:**
- Bir admin'e yeni gym atandığında (`updateAdmin` veya `createGym` admin gymIds'e eklendiğinde)
- Bir admin'den gym kaldırıldığında (`deleteGym`, `updateAdmin`)
- Coach bir gym'e join olduğunda / kaldırıldığında (`coachJoinGym`, `removeCoachFromGym`, `updateCoach`)
- Student bir gym'e join olduğunda (`joinGym`)

**Önceki davranış:** Backend her request'te Firestore'dan güncel `gymIds` / `gymId`'i okuyordu, bu yüzden client eski token'la istek atsa bile yeni gym'lere erişebiliyordu.

**Yeni davranış:** Backend artık SADECE JWT custom claim'lerine güveniyor. Client eski token kullanırsa yeni gym'lerin olmadığı (veya silinmiş gym'in hâlâ olduğu) bir token ile çalışır → permission-denied hatası alır.

#### iOS için yapılması gerekenler:
1. **Kendi profilini etkileyen mutation'lardan sonra** ID token'ı zorla yenile:
```swift
// Örnek: joinGym, updateAdmin (kendi UID'si ise) sonrası
try await Auth.auth().currentUser?.getIDToken(forcingRefresh: true)
```

2. **Başka bir kullanıcının claim'lerini değiştiren admin işlemleri** (örn. superadmin → admin'e gym atama) için:
   - O kullanıcı uygulamayı bir sonraki açışında otomatik yeni token alır (1 saatlik refresh cycle)
   - Anlık ihtiyaç varsa: backend `setCustomUserClaims` sonrası ilgili kullanıcıya FCM ile signal gönderip client'ta force refresh tetiklenebilir (ileride gerekirse eklenir)

3. **Permission-denied error handling:** Yeni claim eklendiği halde token yenilenmediyse `permission-denied` döner. Bu hata yakalanırken otomatik token refresh + retry mantığı kurulması önerilir:
```swift
catch let error as NSError where error.code == FunctionsErrorCode.permissionDenied.rawValue {
    try await Auth.auth().currentUser?.getIDToken(forcingRefresh: true)
    // tek seferlik retry
}
```

#### Web admin (Vite+React) için:
- Aynı pattern, Firebase JS SDK ile:
```ts
await firebase.auth().currentUser?.getIdToken(true)
```
- Mevcut Zustand store'da auth state subscription varsa, mutation sonrası token refresh tetiklenmeli.

#### 🟢 Performans
- Her authenticated endpoint çağrısı **~100ms daha hızlı** (frontend tarafında ek iş gerekmez)

---

### K2 — Sequential Firestore okumaları paralelleştirildi
**Tarih:** 2026-04-18
**Backend dosyaları:**
- `functions/src/common/functions/getMyProfile.ts`
- `functions/src/student/functions/register.ts`
- `functions/src/gym/functions/getGymDetails.ts`

#### 🟢 Performans
**Etkilenen endpoint'ler:** `getMyProfile`, `registerStudent`, `getGymDetails`
**Değişiklik:** Bağımsız Firestore okuma/yazma işlemleri `Promise.all` ile paralel hale getirildi.

**Frontend için yapılması gereken:** **HİÇBİR ŞEY**
- Response shape'leri tamamen aynı
- Hata kodları aynı
- Sadece cevap süreleri ~100ms daha hızlı

**Test edilirken farkedilebilir:**
- `getMyProfile` çağrısı (uygulama açılışında çalışan ana profil endpoint'i) hissedilir derecede hızlı
- Yeni öğrenci kaydı (`registerStudent`) ~100ms hızlı
- Salon detay açma (`getGymDetails`) admin panelinde hızlı

ℹ️ **Not:** `useSession` (seans düşürme) ve `getCoachSchedules` bu pas dışında bırakıldı; bağımlılıkları zincirli olduğu için K6 (claim'e güven) ile dolaylı olarak hızlanacaklar.

---

### K3 — `logError` fire-and-forget
**Tarih:** 2026-04-18
**Backend dosyaları:** 87 dosyada toplu replace (`await logError` → `void logError`)

#### 🟢 Performans
**Etkilenen senaryo:** Backend'de hata fırlatıldığında client'a dönen error response.

**Frontend için yapılması gereken:** **HİÇBİR ŞEY**
- Hata kodları ve hata mesajları aynı (HttpsError yapısı değişmedi)
- Client'a dönen response shape aynı
- Hata cevapları ~100ms daha hızlı

#### ℹ️ Bilgi (test için faydalı)
- iOS tarafında error path testleri sırasında (örn. yetkisiz istek → permission-denied) cevap süresi biraz daha kısa hissedilir
- Backend log paneli (Firestore `errorLogs` collection) gözlemlerken **çok nadir log kaybı** olabilir; bu Cloud Functions instance'ının fire-and-forget promise tamamlanmadan freeze olmasından kaynaklanır. Production'da ciddi log eksikliği görülürse backend tarafında ek mitigation yapılacak (frontend'i etkilemez)

---

### K4 — `getStudentSchedule` coach batch lookup + correctness
**Tarih:** 2026-04-18
**Backend dosyası:** `functions/src/schedule/functions/getStudentSchedule.ts`

#### 🟡 Davranışsal (correctness fix)
**Etkilenen endpoint:** `getStudentSchedule` (paket bazlı / reformer salonu için randevu listesi)

**Önceki davranış:** Eğer bir appointment'ın denormalized `coachName`'i eksikse, tek bir fallback coach ismi seçilip **tüm eksik appointment'lara aynı isim atanıyordu**. Aynı subscription içinde farklı coach'lar varsa yanlış isim gösteriliyordu (nadiren).

**Yeni davranış:** Her eksik appointment kendi gerçek coach ismini alır (batch lookup ile).

**Frontend için yapılması gereken:**
- iOS: Eğer bu endpoint'in cevabındaki `coachName` field'ına dayalı UI varsa, bazı eski appointment'ların ismi değişebilir (daha doğrusuna). Eski yanlış isimleri snapshot olarak cache'liyorsanız invalidate edin.
- Test edilecek: paket aboneliği olan student'ın "Randevularım" ekranı

#### 🟢 Performans
- Performans değişimi yok (zaten optimal idi); sadece edge-case correctness fix

---

### K5 — `createAppointments` transaction içi paralel reads + counter field
**Tarih:** 2026-04-18 (faz 1 + faz 2)
**Backend dosyaları:**
- `functions/src/schedule/functions/createAppointments.ts`
- `functions/src/schedule/functions/cancelAppointment.ts`
- `functions/src/schedule/functions/deleteAppointmentsPlan.ts`
- `functions/src/schedule/functions/updateAppointmentsPlan.ts`
- `functions/src/subscription/types/subscription.model.ts` (yeni opsiyonel field)
- `functions/src/superadmin/functions/migrateSubscriptionCounters.ts` (yeni endpoint)

#### 🟢 Performans
**Etkilenen endpoint'ler:** `createAppointments`, `cancelAppointment`, `deleteAppointmentsPlan`, `updateAppointmentsPlan`

**Değişiklik:**
- Faz 1: Transaction içi paralel read (~100-150ms)
- Faz 2: `subscriptions.scheduledSessionsCount` counter field eklendi. Mutation'lar artık eski `where + in` query yerine atomic `FieldValue.increment(±N)` kullanıyor (~150-200ms ek hız `createAppointments`'ta)

**Frontend için yapılması gereken:** **HİÇBİR ŞEY**
- Response shape aynı, davranış aynı, atomicity garantileri korundu
- Eski subscription'lar (counter undefined) hala çalışır — her endpoint fallback path içerir

#### ℹ️ Bilgi
- Race condition koruması (aynı anda çift randevu oluşturma) hala aktif (transaction + atomic increment)
- `validation` error'ları (örn. "subscription bu öğrenciye ait değil") hala aynı şekilde döner
- Counter semantiği: `pending + completed + postponed` slot kaplıyor; `cancelled` sayılmıyor

#### 🔴 Ops adımı (yalnızca admin operasyonu — kullanıcıyı etkilemez)
- Deploy sonrası **bir kez** `migrateSubscriptionCounters` çağrılmalı (sadece superadmin yetkisi).
- Web admin panelinde basit bir "Veritabanı Bakımı" sayfası varsa oraya buton olarak eklenebilir (opsiyonel).
- Idempotent: tekrar çağrılırsa zaten doğru olanları atlar, sadece sapmaları düzeltir.
- Cevap: `{ success, processed, updated, skipped, errors }` — UI'da göstermek isterseniz bu shape'i kullanın.

---

### K6 — `getMyProfile` role-based direct lookup
**Tarih:** 2026-04-18
**Backend dosyası:** `functions/src/common/functions/getMyProfile.ts`

#### 🟢 Performans
**Etkilenen endpoint:** `getMyProfile` (uygulama açılışında çağrılan ana profil endpoint'i)

**Önceki davranış:** Backend 4 collection'ı (admins, coaches, students, superadmins) sırayla kontrol ediyordu (en kötü 400ms).

**Yeni davranış:** JWT'deki `role` claim'ine göre doğrudan ilgili collection'a gider (1 RPC ~100ms).

**Frontend için yapılması gereken:** **HİÇBİR ŞEY**
- Response shape aynı (`{ success, role, collection, user }`)
- Tüm role'ler için aynı çıktı

#### ⚠️ Edge Case (sadece bilgi için)
- Eğer bir kullanıcının JWT token'ında `role` claim'i yoksa (eski / migration öncesi kayıtlar), backend otomatik fallback'e düşer ve tüm collection'ları **paralel** olarak (sequential değil) kontrol eder. Yine ~100ms.
- Pratikte tüm aktif kullanıcılarda role claim mevcut, bu fallback nadiren tetiklenir.

#### Beklenen iOS UX iyileştirmesi
- Uygulama açılışında profil yükleme süresi hissedilir derecede kısalır (özellikle superadmin / coach hesaplarında)

---

### O1 — `serializeTimestamps` allowlist-path optimizasyonu
**Tarih:** 2026-04-18
**Backend dosyası:** `functions/src/common/utils/serialize.ts`

#### 🟡 Davranışsal (düşük risk)
**Etkilenen endpoint'ler:** `serializeTimestamps` kullanan tüm read endpoint'ler

**Önceki davranış:** Tüm response nesnesi recursive geziliyor, bulunan tüm `Timestamp` alanları otomatik dönüştürülüyordu.

**Yeni davranış:** Bilinen schema path'leri dönüştürülüyor (`createdAt`, `updatedAt`, `date`, `monthlyPayments[].dueDate` vb.).

**Frontend için yapılması gereken:**
- Mevcut ekranlar için zorunlu değişiklik yok.
- Eğer frontend özel bir alanda daha önce implicit dönüştürülen ama artık allowlist'te olmayan bir timestamp kullanıyorsa backend'e path ekletilmeli.

#### 🟢 Performans
- Büyük payload'larda endpoint cevapları daha hızlı gelir.

---

### O2 — `getPaymentRequests` pagination + chunk query optimizasyonu
**Tarih:** 2026-04-18
**Backend dosyası:** `functions/src/payment/functions/getPaymentRequests.ts`

#### 🔴 Breaking — Listeleme artık sayfalı
**Etkilenen endpoint:** `getPaymentRequests`

**Yeni request alanları:**
- `limit` (opsiyonel, default: 50, max: 200)
- `startAfterTimestamp` (opsiyonel, bir önceki sayfanın `nextCursor` değeri)

**Yeni response alanları:**
- `hasMore`
- `nextCursor`
- `lastTimestamp`

**Önemli:** Cursor/pagination uygulanmazsa frontend yalnızca ilk sayfayı görür.

#### iOS için yapılması gerekenler:
1. İlk çağrıda `limit` gönder (örn. 50).
2. `hasMore === true` ise bir sonraki çağrıda `startAfterTimestamp = nextCursor` gönder.
3. Listeyi sayfa sayfa birleştir (append).

#### Web admin (Vite+React) için:
1. Ödeme listesinde infinite scroll veya "Daha Fazla" butonu ekle.
2. Zustand/React Query store'unda `nextCursor` state'ini tut.
3. Filtre (`status`, `gymId`) değişince cursor'ı resetle.

#### 🟢 Performans
- Özellikle çok salon yöneten adminlerde ilk yanıt süresi ve bellek kullanımı belirgin iyileşir.

---

### O3 — `logActivity` fire-and-forget
**Tarih:** 2026-04-18
**Backend dosyaları:** 57 dosyada toplu replace (`await logActivity` → `void logActivity`)

#### 🟢 Performans
**Etkilenen senaryo:** Başarılı mutation response'ları (log yazan akışlar).

**Frontend için yapılması gereken:** **HİÇBİR ŞEY**
- Response shape ve hata kodları değişmedi.
- İşlem sonrası ekran güncellemesi daha hızlı hissedilir.

#### ℹ️ Bilgi
- Çok nadir durumda activity log write atlanabilir; kullanıcı akışını etkilemez.

---

### S4 — Hot endpoint'lerde `minInstances=1`
**Tarih:** 2026-04-18
**Backend dosyaları:**
- `functions/src/common/functions/getMyProfile.ts`
- `functions/src/student/functions/getGymMembers.ts`
- `functions/src/student/functions/getCoachMembers.ts`
- `functions/src/coach/functions/getGymCoaches.ts`

#### 🟢 Performans
**Etkilenen endpoint'ler:** `getMyProfile`, `getGymMembers`, `getCoachMembers`, `getGymCoaches`

**Frontend için yapılması gereken:** **HİÇBİR ŞEY**
- API kontratı değişmedi.
- Özellikle ilk açılış / boş liste sorgularında daha stabil ve hızlı cevap beklenir.

---

## Şablonlar (yeni madde eklerken kullan)

### Şablon: Backend Madde Tamamlandı
```markdown
### KX — [Madde başlığı]
**Tarih:** YYYY-MM-DD
**Backend dosyası:** `path/to/file.ts`

#### [🔴/🟡/🟢/ℹ️] [Etki başlığı]
**Etkilenen endpoint'ler:** ...
**Önceki davranış:** ...
**Yeni davranış:** ...

#### iOS için yapılması gerekenler:
1. ...

#### Web admin için:
1. ...
```

---

## Genel Frontend Notları (sürekli güncel)

### Token Yönetimi Stratejisi
> K1 sonrası bu kritik hale geldi.

- **Token TTL:** Firebase ID token 1 saatlik. Her saat client SDK otomatik refresh eder.
- **Custom claim değişikliği = manuel refresh:** Backend `setCustomUserClaims` çağırdığında, client otomatik bilmez. Force refresh gerekir.
- **Tetikleme noktaları:**
  - Kullanıcı kendi profilinde claim değişen mutation yaptıktan sonra (örn. `joinGym`)
  - `permission-denied` hatası alındığında (tek seferlik retry)
  - Uygulama foreground'a geldiğinde (opsiyonel, conservative)

### API Response Shape
Genel olarak response şemaları korunuyor.

İstisna:
- `getPaymentRequests` artık pagination alanları döndürüyor: `hasMore`, `nextCursor`, `lastTimestamp`.

### Performans Beklentileri
Kritik + orta optimizasyonlar tamamlandı. Ortalama endpoint cevabı **<1s** hedefi (cold start hariç) büyük ölçüde karşılanmış olmalı. Kalan küçük maddeler tamamlandığında ilk istek deneyimi daha da stabil hale gelir.
