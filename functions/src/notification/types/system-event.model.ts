export type SystemEventType =
    | 'payment_due'           // ödeme vadesi yaklaşıyor
    | 'payment_overdue'       // ödeme gecikti
    | 'commitment_ending'     // taahhüt bitiyor (örn. 30 gün kala)
    | 'commitment_expired'    // taahhüt bitti → baz fiyata geçildi
    | 'package_low'           // pakette az seans kaldı (örn. 2 seans)
    | 'package_exhausted'     // paket bitti
    | 'subscription_expired'  // abonelik süresi doldu
    | 'session_completed'     // seans tamamlandı
    | 'session_postponed';    // seans ertelendi

export interface SystemEvent {
    id: string;
    type: SystemEventType;
    gymId: string;
    targetUserId: string;    // kime gönderilecek (öğrenci veya hoca)
    relatedEntityId: string; // subscriptionId, appointmentId vs.
    payload: Record<string, any>;
    createdAt: FirebaseFirestore.Timestamp;
    notified: boolean;       // ileride FCM trigger bunu false olanları işler
}