/**
 * Feature creation data transfer object
 */
export interface CreateFeatureData {
    name: string;
}

/**
 * Feature deletion data transfer object
 */
export interface DeleteFeatureData {
    id: string; // The ID of the feature to delete (e.g., the string value itself or a unique ID)
}

/**
 * Interface for stored feature items
 */
export interface FeatureItem {
    id: string;
    name: string;
    createdAt?: any; // Firestore Timestamp
}
