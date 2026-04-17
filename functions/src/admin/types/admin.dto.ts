/**
 * Admin registration data transfer object
 */
export interface RegisterAdminData {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    gymIds?: string[]; // Changed from gymId to gymIds array
}

/**
 * Admin self-registration data transfer object
 */
export interface RegisterAdminSelfData extends RegisterAdminData {
    masterKey: string;
}

/**
 * Admin update data transfer object
 */
export interface UpdateAdminData {
    adminUid: string;
    firstName?: string;
    lastName?: string;
    phoneNumber?: string;
    email?: string;
    photoUrl?: string;
    // Three ways to update gymIds:
    gymIds?: string[]; // Replace all gym IDs
    addGymIds?: string[]; // Add specific gym IDs
    removeGymIds?: string[]; // Remove specific gym IDs
}
