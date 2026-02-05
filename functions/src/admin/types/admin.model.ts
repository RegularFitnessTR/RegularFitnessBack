import { BaseUser } from '../../common/types/base';

/**
 * Admin User - Stored in 'admins' collection
 */
export interface AdminUser extends BaseUser {
    role: 'admin';
    gymIds: string[]; // Array to support multiple gyms
}
