/**
 * Coach creation data transfer object
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
