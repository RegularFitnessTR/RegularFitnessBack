# Backend Optimizasyon Planı

> **Amaç:** Endpoint cevap sürelerini 2-6s aralığından <1s'e indirmek.
> **Stack:** Firebase Cloud Functions (Node 24, TypeScript) + Firestore + Firebase Auth
> **Son güncelleme:** 2026-04-18

## Durum Lejantı
- ✅ **Tamamlandı** — production'a hazır, test edildi
- 🚧 **Devam ediyor** — kısmen yapıldı veya review aşamasında
- ⏳ **Beklemede** — sıraya alındı, henüz başlanmadı
- ❌ **İptal** — gerekli değil veya yanlış teşhis

## İlerleme Özeti

| Öncelik | Toplam | Tamam | Kalan | Beklenen Kazanç (Kalan) |
|---|---|---|---|---|
| 🔴 Kritik | 6 | 6 | 0 | — |
| 🟡 Orta | 3 | 3 | 0 | — |
| 🟢 Küçük | 4 | 1 | 3 | ~0.1-0.2s |

**🎉 Kritik + orta maddeler tamamlandı!** Backend cevap süreleri 2-6s aralığından beklenen 0.5-1.2s aralığına düşmüş olmalı (cold start hariç).

---

## 🔴 KRİTİK MADDELER

### ✅ K1. Middleware Firestore okumasını kaldır
**Dosya:** `functions/src/common/utils/onCall.ts`
**Tamamlandı:** 2026-04-18
**Yapılan:**
- `hydrateRoleGymClaims()` ve `normalizeGymIds()` fonksiyonları silindi
- Artık her authenticated request'te `ADMINS/COACHES/STUDENTS` collection'larına gereksiz `.get()` çağrısı yapılmıyor
- Custom claims kayıt anında set ediliyor (`createAdmin`, `registerCoach` vb.) ve `syncGymClaims` ile güncelleniyor — middleware redundant idi

**Kazanılan:** Her authenticated endpoint çağrısında ~100ms

**Frontend etkisi:** ✓ FRONTEND_ETKILERI.md'ye eklendi (token refresh zorunluluğu)

---

### ✅ K2. Sequential Firestore okumalarını paralelleştir (`Promise.all`)
**Tamamlandı:** 2026-04-18

**Yapılan değişiklikler:**
- `functions/src/common/functions/getMyProfile.ts` — student rolü için `gymDoc + coachDoc` enrichment'ı `Promise.all` ile paralelleştirildi (~100ms)
- `functions/src/student/functions/register.ts` — `setCustomUserClaims + students.set` paralel write (~100ms)
- `functions/src/gym/functions/getGymDetails.ts` — speculative paralel: `canAccessGymByRole + gymDoc.get()` aynı anda (~100ms admin/superadmin/cached-claim case'inde)

**Atlanan dosyalar (gerçek paralelleştirme fırsatı yok):**
- `useSession.ts` — student → subscription → gym **zincirli bağımlılık**, her okuma bir öncekinin çıktısına dayanıyor
- `getCoachSchedules.ts` — coach → gym **zincirli bağımlılık**; coach rolü için K6 (claim'e güven) bunu ortadan kaldıracak

**Kazanılan:** Etkilenen 3 endpoint'te ~100ms her birinde (toplam etki kullanım desenine bağlı)

**Frontend etkisi:** Yok (response shape değişmedi)

**Notlar:**
- `getGymDetails`'taki speculative paralel: permission-denied case'de küçük bir wasted gym read maliyeti var, ancak red durumları nadir → kabul edilebilir
- `register.ts`'deki paralel write: `setCustomUserClaims` veya `students.set`'ten biri başarısız olursa orphan state olabilir, ancak orijinal sıralı kod da aynı garantisizliğe sahipti

---

### ✅ K3. `logError` fire-and-forget hale getirildi
**Tamamlandı:** 2026-04-18

**Yapılan:**
- `await logError(...)` → `void logError(...)` toplu replace (87 dosya, 93 yer)
- `logError.ts` zaten içeriden try/catch ile sarılı (satır 80-83) ve hiç throw etmiyor → `await` etmek yalnızca client'ı bekletiyordu
- `void` operator ile TypeScript floating-promise uyarısı bastırıldı

**Kazanılan:** Error response path'inde ~100ms (her hata bir Firestore write bekliyordu)

**⚠️ Bilinen Trade-off (Cloud Functions Background Activity):**
Firebase Cloud Functions response döndükten sonra background promise'lerin tamamlanması **garanti değildir**. Instance hızlıca freeze edilirse Firestore write tamamlanmadan kesilebilir → log kaybı riski.

**Pratikte:** Genelde instance birkaç saniye warm kalır ve kısa Firestore write tamamlanır. Production'da log gözleminde aralıklı eksiklikler olursa pattern revize edilebilir (örn. Pub/Sub queue'ya taşı veya `Promise.race` ile 50ms timeout ekle).

**Frontend etkisi:** Yok (response shape aynı, sadece hata cevapları biraz daha hızlı)

---

### ✅ K4. `getStudentSchedule` coach lookup → batch + correctness
**Tamamlandı:** 2026-04-18

**Yeniden teşhis:** Mevcut kod aslında N+1 yapmıyordu — tek bir `fallbackCoachId` seçip bir kere okuyordu. **Asıl sorun perf değil correctness'di**: aynı subscription içinde farklı `coachId` değerleri varsa hepsi yanlış coach ismi alıyordu.

**Yapılan:**
- Eksik `coachName`'li appointment'lar için benzersiz coachId'leri toplayıp `db.getAll(...)` ile tek RPC'de batch çek
- Her appointment kendi gerçek coach'unun ismini alıyor (`coachNameMap[coachId]`)
- `getCoachSchedules.ts` ile aynı pattern (tutarlılık)

**Kazanılan:** Perf ~0ms (zaten tek fetch'ti); correctness sağlandı (edge case)

**Frontend etkisi:** Yok (response shape aynı, isimler bazen daha doğru)

---

### ✅ K5. `createAppointments` transaction içi paralel reads + counter field
**Tamamlandı:** 2026-04-18 (faz 1) → 2026-04-18 (faz 2: counter migration)

**Faz 1 (paralel reads):**
- Transaction içinde `subDoc fetch` + `existing appointments query` `Promise.all` ile paralelleştirildi
- 2 sequential RPC → 1 parallel RPC duration
- Kazanç: ~100-150ms

**Faz 2 (schema değişikliği — counter field):**
- `PackageSubscription.scheduledSessionsCount?: number` field eklendi (`subscription.model.ts`)
- Counter semantiği: `status in ['pending','completed','postponed']` olan appointment sayısı (cancelled HARİÇ, çünkü iptal slot kaplamıyor)
- **Race-safe yazım:** Tüm mutation endpoint'leri `FieldValue.increment(±N)` kullanır, absolute set değil
- Etkilenen endpoint'ler:
  - `createAppointments.ts` — counter varsa kullan (eski query atlanır), yoksa fallback query + on-the-fly migrate
  - `cancelAppointment.ts` — transaction'a çevrildi, `pending/postponed → cancelled` geçişinde counter -1
  - `deleteAppointmentsPlan.ts` — silinen non-cancelled sayısı kadar decrement
  - `updateAppointmentsPlan.ts` — net delta increment (`new - editableNonCancelled`)
- **Migration endpoint:** `superadmin/functions/migrateSubscriptionCounters.ts` — superadmin-only, idempotent, paginated (chunk=25), her PACKAGE sub için `count()` aggregation ile gerçek değeri yazar
- Counter undefined olan eski subscription'lar bozulmaz (her endpoint fallback path'i içerir, migration sonrası counter aktif)
- Kazanç: `createAppointments` içindeki `where + in` query'si tamamen elenir → ~150-200ms ek hız

**Atomicity & Race protection:** Aynı (transaction + atomic increment garantileri).

**Frontend etkisi:** Yok (response shape ve davranış aynı). Ops gereği: deploy sonrası bir kez `migrateSubscriptionCounters` superadmin paneli/console'dan çağrılmalı (idempotent, tekrar çağrıldığında zaten doğru olanları atlıyor).

---

### ✅ K6. `getMyProfile` — role claim'e güven, 4-collection sequential kaldırıldı
**Tamamlandı:** 2026-04-18

**Yapılan:**
- `ROLE_TO_COLLECTION` map ile role claim'e göre tek doğrudan lookup (~100ms tek RPC)
- Eski / claim'siz kullanıcılar için fallback: tüm collection'lar `Promise.all` ile **paralel** kontrol (sequential for-loop yerine)
- K2'deki student gym+coach enrichment paralelleştirmesi korundu

**Önceki vs Şimdi:**
- Superadmin worst case: 4 sequential RPC (~400ms) → 1 RPC (~100ms)
- Admin: 1 RPC (~100ms) → 1 RPC (~100ms) — değişim yok
- Coach/Student: 2-3 RPC sequential → 1 RPC + paralel enrichment

**Kazanılan:** Ortalama 100-300ms (kullanıcı rolüne göre)

**Frontend etkisi:** Yok (response shape aynı)

**Risk:** Düşük — role claim eksikse otomatik fallback aktif olur, kullanıcı erişimini kaybetmez

---

## 🟡 ORTA SEVİYE MADDELER

### ✅ O1. `serializeTimestamps` allowlist'e geçir
**Dosya:** `functions/src/common/utils/serialize.ts`
**Tamamlandı:** 2026-04-18

**Yapılan:**
- `serializeTimestamps` path allowlist tabanına geçirildi (global recursive traversal kaldırıldı)
- Bilinen timestamp path'leri eklendi: `createdAt/updatedAt/timestamp/date`, `assignedAt/startDate/endDate`, `processedAt`, `checkedInAt/checkedOutAt`, `monthlyPayments.[].dueDate/paidDate` vb.
- `details.*` ve `payload.*` gibi dinamik ama tek-seviye timestamp taşıyan alanlar korunarak dönüştürülüyor
- Opsiyonel genişletme için `serializeTimestamps(value, { timestampPaths })` desteği eklendi

**Kazanılan:** Büyük response'larda ~30-80ms (payload boyutuna göre)

**Risk:** ORTA-DÜŞÜK — yeni timestamp field eklendiğinde allowlist'e path eklenmezse dönüşüm kaçabilir

**Frontend etkisi:** Düşük — mevcut kullanılan alanlarda response formatı korunur

---

### ✅ O2. `getPaymentRequests` chunk query optimizasyonu
**Dosya:** `functions/src/payment/functions/getPaymentRequests.ts`
**Tamamlandı:** 2026-04-18

**Yapılan (a seçeneği):**
- Cursor tabanlı pagination eklendi: `limit` (default 50, max 200) + `startAfterTimestamp`
- Response'a pagination alanları eklendi: `hasMore`, `nextCursor`, `lastTimestamp`
- Admin çoklu gym sorgusunda her `in` chunk'ına limit uygulanıp sonuçlar birleştirilerek global sıralanıyor (artık tüm geçmiş kayıtlar tek istekte çekilmiyor)
- Coach ve superadmin akışlarına da aynı cursor/limit modeli eklendi
- Student akışında mevcut index riskini artırmamak için filtre+sıralama korunup sonuç seti response öncesi pagine edildi

**Kazanılan:** Çok salonlu admin senaryolarında ~200-500ms ve daha düşük bellek kullanımı

**Risk:** Düşük — pagination cursor semantiği net; backward-compatible alanlar korundu

**Frontend etkisi:** Var — liste ekranlarının `nextCursor` ile sayfalı akışa geçirilmesi önerilir

---

### ✅ O3. `logActivity` fire-and-forget
**Dosya:** `functions/src/log/utils/logActivity.ts` ve çağıran handler'lar
**Tamamlandı:** 2026-04-18

**Yapılan:**
- `await logActivity(...)` → `void logActivity(...)` toplu dönüşüm (57 dosya)
- `logActivity` utility zaten internal try/catch + `void logError` ile non-throw garanti ediyor
- Success path artık activity log write'ını beklemiyor

**Kazanılan:** Loglanan success akışlarında ~70-120ms

**Risk:** Düşük — nadir durumda background log write atlanabilir (instance freeze)

**Frontend etkisi:** Yok (response shape ve kodları aynı)

---

## 🟢 KÜÇÜK İYİLEŞTİRMELER

### ⏳ S1. Staging'de `enforceAppCheck` opsiyonel
**Dosya:** `functions/src/index.ts:22`
**Çözüm:** Environment'a göre koşullu set et. Production'da true kalsın.
**Frontend etkisi:** Staging'de App Check token'ı zorunlu olmaz

### ⏳ S2. Rate limiter Memorystore (Redis) ile paylaşımlı
**Dosya:** `functions/src/common/utils/rateLimit.ts`
**Çözüm:** 10 instance arası tutarlılık için. Sadece gerçekten sorun olursa.
**Frontend etkisi:** Yok

### ⏳ S3. Production'da `console.error/warn` flood azaltma
**Çözüm:** Structured logger (Pino veya Cloud Logging direct).
**Frontend etkisi:** Yok

### ✅ S4. Cold start azaltımı için hot endpoint'lerde `minInstances=1`
**Dosyalar:**
- `functions/src/common/utils/onCall.ts`
- `functions/src/common/functions/getMyProfile.ts`
- `functions/src/student/functions/getGymMembers.ts`
- `functions/src/student/functions/getCoachMembers.ts`
- `functions/src/coach/functions/getGymCoaches.ts`
**Tamamlandı:** 2026-04-18
**Yapılan:**
- `onCall` wrapper'ı callable options alacak şekilde genişletildi
- Sık kullanılan listeleme/profil endpoint'lerine fonksiyon bazlı `minInstances: 1` tanımlandı
- Global `minInstances` verilmedi; maliyet artışı yalnız hot path ile sınırlandı

**Beklenen kazanç:** Cold start etkisinde ~1.0-2.5s iyileşme (özellikle boş liste sorgularında)

**Risk / Trade-off:** Düşük-ORTA — sürekli warm instance maliyeti artar

**Frontend etkisi:** İlk istekler daha stabil/hızlı; response shape değişmez

---

## Çalışma Notları

### Kararlar
- **2026-04-18:** publicId için Firestore index eklenmesi düşünülmüştü, ancak tek-alan equality query'leri için Firestore otomatik index oluşturduğundan iptal edildi. Gerçek kazanç publicId'yi document ID olarak kullanmak (`.doc(publicId)`) olur — büyük migration, şimdilik kapsam dışı.

### Sıradaki Hedef
**S1, S2, S3, S4 (Küçük iyileştirmeler).** Kritik ve orta maddeler tamamlandı. Bir sonraki iterasyon staging/prod konfigürasyon iyileştirmeleri ve cold-start azaltma üzerine.

**Deploy sonrası ops adımı:** `migrateSubscriptionCounters` bir kez superadmin'den çağrılmalı (idempotent, eski subscription'ların counter'ını backfill eder).

### Tamamlandığında Toplam Beklenen Kazanç
~1.9-3.4 saniye iyileşme gerçekleşmiş olmalı (kullanım deseni ve cold start hariç). Kalan küçük maddelerden ek ~0.1-0.3s beklenir.
