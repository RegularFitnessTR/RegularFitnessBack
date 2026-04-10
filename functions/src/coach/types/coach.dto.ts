/**
 * Coach self-registration data transfer object
 */
export interface RegisterCoachData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    expertise: string;
    experienceYears: number;
    gymPublicId?: string; // Optional — gym public ID to join during registration
}

/**
 * Coach creation data transfer object (legacy — admin-created, no longer used)
 */
export interface CreateCoachData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    expertise: string;
    experienceYears: number;
    gymId?: string;
}

/**
 * Coach update data transfer object
 */
export interface UpdateCoachData {
    coachUid: string;
    firstName?: string;
    lastName?: string;
    photoUrl?: string;
    email?: string;
    phoneNumber?: string;
    expertise?: string;
    experienceYears?: number;
    gymId?: string;
}
