import { LogAction } from "../types/log.enums";
import { ActivityLog } from "../types/log.model";

const LOG_TITLE_BY_ACTION: Record<LogAction, string> = {
    [LogAction.CREATE_ADMIN]: "Yeni admin oluşturuldu",
    [LogAction.UPDATE_ADMIN]: "Admin bilgileri güncellendi",
    [LogAction.DELETE_ADMIN]: "Admin silindi",
    [LogAction.DELETE_ADMIN_ACCOUNT]: "Admin hesabını sildi",

    [LogAction.REGISTER_COACH]: "Eğitmen kaydı oluşturuldu",
    [LogAction.CREATE_COACH]: "Yeni eğitmen oluşturuldu",
    [LogAction.UPDATE_COACH]: "Eğitmen bilgileri güncellendi",
    [LogAction.DELETE_COACH]: "Eğitmen silindi",
    [LogAction.DELETE_COACH_ACCOUNT]: "Eğitmen hesabını sildi",
    [LogAction.UPDATE_COACH_PROFILE]: "Eğitmen profili güncellendi",
    [LogAction.COACH_JOIN_GYM]: "Eğitmen salona katıldı",
    [LogAction.REMOVE_COACH_FROM_GYM]: "Eğitmenin salon ilişiği kesildi",

    [LogAction.REGISTER_STUDENT]: "Yeni öğrenci kaydı oluşturuldu",
    [LogAction.DELETE_STUDENT]: "Öğrenci hesabını sildi",
    [LogAction.ASSIGN_COACH]: "Öğrenciye eğitmen atandı",
    [LogAction.JOIN_GYM]: "Öğrenci salona katıldı",
    [LogAction.UPDATE_STUDENT_PROFILE]: "Öğrenci profili güncellendi",
    [LogAction.UPDATE_STUDENT_PASSWORD]: "Öğrenci şifresi güncellendi",

    [LogAction.CREATE_GYM]: "Yeni spor salonu oluşturuldu",
    [LogAction.UPDATE_GYM]: "Spor salonu bilgileri güncellendi",
    [LogAction.DELETE_GYM]: "Spor salonu silindi",
    [LogAction.ADD_PACKAGE]: "Paket eklendi",
    [LogAction.UPDATE_PACKAGE]: "Paket güncellendi",
    [LogAction.DELETE_PACKAGE]: "Paket silindi",
    [LogAction.UPDATE_MEMBERSHIP]: "Üyelik bilgileri güncellendi",
    [LogAction.ADD_AMENITY]: "Salon özelliği eklendi",
    [LogAction.DELETE_AMENITY]: "Salon özelliği silindi",

    [LogAction.CREATE_PAYMENT_REQUEST]: "Yeni ödeme talebi oluşturuldu",
    [LogAction.APPROVE_PAYMENT]: "Ödeme onaylandı",
    [LogAction.REJECT_PAYMENT]: "Ödeme reddedildi",

    [LogAction.CREATE_MEASUREMENT]: "Ölçüm kaydı oluşturuldu",

    [LogAction.ASSIGN_WORKOUT_SCHEDULE]: "Antrenman programı atandı",
    [LogAction.UPDATE_WORKOUT_SCHEDULE]: "Antrenman programı güncellendi",
    [LogAction.DELETE_WORKOUT_SCHEDULE]: "Antrenman programı silindi",
    [LogAction.TOGGLE_SCHEDULE_STATUS]: "Program durumu güncellendi",

    [LogAction.ASSIGN_SUBSCRIPTION]: "Abonelik atandı",
    [LogAction.USE_SESSION]: "Seans kullanımı işlendi",

    [LogAction.CREATE_PARQ_TEST]: "PAR-Q testi oluşturuldu",

    [LogAction.REGISTER_SUPERADMIN]: "Superadmin kaydı oluşturuldu",

    [LogAction.CREATE_GYM_TYPES]: "Salon türleri eklendi",
    [LogAction.DELETE_GYM_TYPES]: "Salon türleri silindi",
    [LogAction.CREATE_AMENITIES]: "Salon özellikleri eklendi",
    [LogAction.DELETE_AMENITIES]: "Salon özellikleri silindi",
    [LogAction.CREATE_SOCIAL_MEDIA_TYPES]: "Sosyal medya türleri eklendi",
    [LogAction.DELETE_SOCIAL_MEDIA_TYPES]: "Sosyal medya türleri silindi",

    [LogAction.GYM_CHECK_IN]: "Salona giriş yapıldı",
    [LogAction.GYM_CHECK_OUT]: "Salondan çıkış yapıldı",
};

export type ActivityLogWithTitle = ActivityLog & { title: string };

export function resolveLogTitle(log: { action: LogAction; title?: string | null }): string {
    const existingTitle = log.title?.trim();
    if (existingTitle) {
        return existingTitle;
    }

    return LOG_TITLE_BY_ACTION[log.action] || "Sistem işlemi";
}

export function mapLogForResponse(log: ActivityLog): ActivityLogWithTitle {
    return {
        ...log,
        title: resolveLogTitle(log)
    };
}
