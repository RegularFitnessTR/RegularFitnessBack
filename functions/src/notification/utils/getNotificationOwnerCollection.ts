import { COLLECTIONS } from "../../common";
import { UserRole } from "../../common/types/base";

const ROLE_COLLECTION: Record<UserRole, string> = {
    student: COLLECTIONS.STUDENTS,
    coach: COLLECTIONS.COACHES,
    admin: COLLECTIONS.ADMINS,
    superadmin: COLLECTIONS.SUPERADMINS
};

export const getNotificationOwnerCollection = (role: UserRole): string => {
    return ROLE_COLLECTION[role];
};
