import { BaseUser } from '../../common/types/base';

/**
 * Coach User - Stored in 'coaches' collection
 */
export interface CoachUser extends BaseUser {
    role: 'coach';
    expertise: string;
    experienceYears: number;
    qrCodeString: string; // For student assignment via QR code
    gymId?: string; // Optional: which gym they belong to
}
