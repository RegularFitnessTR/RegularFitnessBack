import { GymAmenity, GymType } from './gym.enums';
import { GymAddress, SocialMediaLinks } from './gym.model';
import { PaymentMethod } from './gym.payment';

/**
 * Gym creation data transfer object
 */
export interface CreateGymData {
    name: string;
    gymType: GymType;              // Required
    paymentMethod?: PaymentMethod;  // Optional - can be added later
    amenities: GymAmenity[];
    address: GymAddress;
    phoneNumber: string;
    socialMedia?: SocialMediaLinks[];
}

/**
 * Gym update data transfer object
 */
export interface UpdateGymData {
    gymId: string;
    name?: string;
    gymType?: GymType;             // Optional for updates
    paymentMethod?: PaymentMethod; // Optional for updates
    amenities?: GymAmenity[];
    address?: Partial<GymAddress>; // Allow partial address updates
    phoneNumber?: string;
    socialMedia?: SocialMediaLinks[];
}
