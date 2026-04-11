# Admin Hesap Silme Senaryosu Raporu

## 1) Amaç

Bu raporun amacı, Apple hesap silme gereksinimini karşılayacak şekilde admin kullanıcısının kendi hesabını silebilmesini sağlarken, hukuki delil niteliğindeki verilerin korunacağı en mantıklı senaryoyu belirlemektir.

## 2) İncelenen Akışlar

- Admin silme: [functions/src/admin/functions/deleteAdmin.ts](functions/src/admin/functions/deleteAdmin.ts)
- Gym silme: [functions/src/gym/functions/deleteGym.ts](functions/src/gym/functions/deleteGym.ts)
- Öğrenci self-delete: [functions/src/student/functions/deleteStudentAccount.ts](functions/src/student/functions/deleteStudentAccount.ts)
- Koç self-delete: [functions/src/coach/functions/deleteCoachAccount.ts](functions/src/coach/functions/deleteCoachAccount.ts)
- Koç-gym ilişik kesme: [functions/src/coach/functions/removeCoachFromGym.ts](functions/src/coach/functions/removeCoachFromGym.ts)
- Öğrenci/koç gym katılımı ve check-in akışları: [functions/src/student/functions/joinGym.ts](functions/src/student/functions/joinGym.ts), [functions/src/coach/functions/coachJoinGym.ts](functions/src/coach/functions/coachJoinGym.ts), [functions/src/gymPresence/functions/gymCheckIn.ts](functions/src/gymPresence/functions/gymCheckIn.ts)
- Abonelik/ödeme/schedule ölçüm akışları: [functions/src/subscription/functions/assignSubscription.ts](functions/src/subscription/functions/assignSubscription.ts), [functions/src/subscription/functions/cancelSubscription.ts](functions/src/subscription/functions/cancelSubscription.ts), [functions/src/payment/functions/getPaymentRequests.ts](functions/src/payment/functions/getPaymentRequests.ts), [functions/src/measurement/functions/getMeasurements.ts](functions/src/measurement/functions/getMeasurements.ts), [functions/src/schedule/index.ts](functions/src/schedule/index.ts)
- Log altyapısı: [functions/src/log/utils/logActivity.ts](functions/src/log/utils/logActivity.ts), [functions/src/log/functions/getAdminLogs.ts](functions/src/log/functions/getAdminLogs.ts), [functions/src/log/functions/getSuperAdminLogs.ts](functions/src/log/functions/getSuperAdminLogs.ts)

## 3) Mevcut Durumdan Kesin Bulgular

1. Mevcut admin silme fonksiyonu sadece superadmin çağırabiliyor.
2. Admin silmede sadece admin auth kullanıcısı ve admin Firestore dokümanı siliniyor; gym veya diğer bağlı veriler için cascade delete yok.
3. Mevcut gym silme fonksiyonu gym dokümanını siliyor, admin gymIds listesinden çıkarıyor, koç/öğrenci referanslarını temizliyor, aktif abonelikleri expired yapıyor, pending-postponed randevuları siliyor.
4. Öğrenci ve koç self-delete akışlarında doğrudan hard delete yerine anonimleştirme + seçici veri temizliği deseni uygulanmış.
5. Owner kontrolü ownerId üzerinden yapılıyor; ownerId silinen admin UID’si kalırsa owner bazlı yönetim pratikte biter, sadece superadmin bypass ile yönetebilir.
6. Gym için lifecycle status (active, frozen, archived gibi) alanı ve bu alana göre merkezi bloklama kuralı bulunmuyor.
7. Firestore delete trigger tabanlı otomatik zincir silme yok; yani bir doküman silinince alttaki ilişkiler trigger ile otomatik düşmüyor.

## 4) Ana Riskler

1. Yanlış tasarımda admin self-delete ile gym hard delete kurgulanırsa, delil niteliğindeki finansal ve operasyonel kayıtların geri döndürülemez kaybı oluşur.
2. Sadece admin dokümanını hard-delete etmek, gym’leri yetim bırakır ve operasyonel sahiplik belirsizliği yaratır.
3. Gym kapatma/silme ile öğrenci-koç bağlarının kökten silinmesi, sonradan hukuk/denetim süreçlerinde geçmiş ilişki zincirinin ispatını zorlaştırır.

## 5) En Mantıklı Senaryo (Önerilen Nihai Model)

### Karar

Admin self-delete işlemi, "hesabı kapat + kişisel veriyi anonimleştir + gym ve bağlı delil verilerini koru" modeli ile yapılmalı. Hard delete yalnızca admin kimlik hesabına uygulanmalı; iş/finans/operasyon verisine uygulanmamalı.

### Gerekçe

1. Apple hesabı silme gereksinimi sağlanır: kullanıcı artık oturum açamaz ve kişisel hesap bilgileri anonimleşir.
2. Hukuki delil bütünlüğü korunur: gym, abonelik, ödeme, ölçüm, randevu, log verileri saklanır.
3. Operasyonel sürdürülebilirlik korunur: veriler silinmediği için geçmiş denetimi ve raporlama mümkün kalır.

### Önerilen İş Kuralları

1. Admin self-delete, gym silme işlemini tetiklememeli.
2. Admin dokümanı anonimleştirilmeli ve isDeleted/deletedAt ile işaretlenmeli.
3. Admin auth kullanıcısı silinmeli.
4. Adminin sahip olduğu gym dokümanları korunmalı; ancak owner silinmesi sonrası yönetim modu netleştirilmeli.
5. Gym için lifecycle alanı eklenmeli: active, owner_deleted_pending_transfer, archived.
6. owner_deleted_pending_transfer durumunda yeni öğrenci/koç katılımı ve yeni check-in engellenmeli; mevcut geçmiş veriler korunmalı.
7. Superadmin için “ownership transfer” akışı eklenmeli (tek gym veya toplu).

## 6) Veri Sınıflandırması (Silinecek vs Korunacak)

### Silinecek / Anonimleştirilecek

1. Admin auth hesabı.
2. Admin PII alanları (email, ad, soyad, telefon, foto).

### Korunacak

1. Gyms (dokümanlar silinmeyecek).
2. Students, coaches, subscriptions, paymentRequests, appointments, measurements, parqTests, workoutSchedules.
3. activityLogs ve errorLogs.
4. system_events ve gymPresence geçmiş kayıtları.

## 7) Uygulama Planı (Onay Sonrası)

1. Yeni callable fonksiyon: deleteAdminAccount (role=admin, self only).
2. Yeni gym lifecycle alanları: lifecycleStatus, ownerDeletedAt, lifecycleUpdatedAt.
3. Admin self-delete içinde:
   1. Admin dokümanını ve sahip olduğu gym listesini oku.
   2. Sahip olunan gym’leri owner_deleted_pending_transfer durumuna çek.
   3. Admin dokümanını anonimleştir ve isDeleted işaretle.
   4. Auth kullanıcısını sil.
   5. Activity log yaz.
4. Aşağıdaki fonksiyonlara lifecycle kontrolü ekle:
   1. joinGym
   2. coachJoinGym
   3. registerStudent (gymPublicId ile kayıt)
   4. registerCoach (gymPublicId ile kayıt)
   5. gymCheckIn
5. Superadmin fonksiyonu ile owner transferi (transferGymOwnership) ekle.
6. İlgili enum/log action güncellemeleri yap.

## 8) Neden Bu Model En Uygun?

1. Apple uyumluluğu ve hukuki saklama yükümlülüğü birlikte sağlanır.
2. Veri kaybı yerine kontrollü erişim daraltması yapılır.
3. Kod tabanındaki mevcut öğrenci/koç self-delete yaklaşımıyla mimari olarak uyumludur.
4. Gelecekte dava, denetim, itiraz ve finansal mutabakat süreçleri için kanıt zinciri bozulmaz.

## 9) Not

Bu rapor aşamasında üretim davranışını değiştiren bir kod güncellemesi yapılmamıştır.
