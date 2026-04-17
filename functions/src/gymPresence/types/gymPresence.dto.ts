export interface GetGymPresenceData {
    gymId: string;
    userRole?: 'student' | 'coach';
    isActive?: boolean;
    limit?: number;
}
