/**
 * SuperAdmin registration data transfer object
 */
export interface RegisterSuperAdminData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    masterKey: string;
}
