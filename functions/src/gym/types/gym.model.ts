import { GymAmenity, SocialMediaPlatform, GymType } from './gym.enums';
import { PaymentMethod } from './gym.payment';

/**
 * Social media link structure
 */
export interface SocialMediaLinks {
    platform: SocialMediaPlatform;
    url: string;
}

/**
 * Address structure for gym
 */
export interface GymAddress {
    street: string;
    city: string;
    state: string;
    zipCode: string;
}

/**
 * Gym model - Stored in 'gyms' collection
 */
export interface Gym {
    id: string;
    publicId: string;  // Auto-generated unique public ID (RF-XX-XXXXXXXX)
    name: string;
    photoUrl?: string;
    ownerId: string; // Admin UID who created this gym
    gymType: GymType;               // reformer | classic
    paymentMethod?: PaymentMethod;  // package | membership
    amenities: GymAmenity[];
    address: GymAddress;
    phoneNumber: string;
    socialMedia?: SocialMediaLinks[];
    createdAt: FirebaseFirestore.Timestamp;
    updatedAt?: FirebaseFirestore.Timestamp;
}
