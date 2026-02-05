import { BaseUser } from '../../common/types/base';

/**
 * SuperAdmin User - Stored in 'superadmins' collection
 */
export interface SuperAdminUser extends BaseUser {
    role: 'superadmin';
}
