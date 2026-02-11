import { setGlobalOptions } from "firebase-functions/v2";

// Clean module imports using barrel exports
import { registerStudent, assignCoach } from "./student";
import { createCoach, updateCoach, deleteCoach, updateCoachProfile } from "./coach";
import { createAdmin, updateAdmin, deleteAdmin } from "./admin";
import { registerSuperAdmin } from "./superadmin";
import { createGym, updateGym, deleteGym, getGymDetails, addPackage, updatePackage, updateMembership } from "./gym";
import { assignSubscription, getStudentSubscription, useSession, getStudentBalance } from "./subscription";
import { createPaymentRequest, approvePayment, rejectPayment, getPaymentRequests } from "./payment";
import { createMeasurement, getMeasurements, getLatestMeasurement } from "./measurement";
import { createParQTest, getParQTests, getLatestParQTest } from "./parq";
import { assignWorkoutSchedule, updateWorkoutSchedule, deleteWorkoutSchedule, getStudentSchedule, toggleScheduleStatus } from "./schedule";
import { createGymTypes, createAmenities, createSocialMediaTypes, deleteAmenities, deleteGymTypes, deleteSocialMediaTypes } from "./applicationFeatures";

// Global ayarlar
setGlobalOptions({ maxInstances: 10 });

// Export functions
export {
    // Student
    registerStudent,
    assignCoach,
    // Coach
    createCoach,
    updateCoach,
    deleteCoach,
    updateCoachProfile,
    // Admin
    createAdmin,
    updateAdmin,
    deleteAdmin,
    // SuperAdmin
    registerSuperAdmin,
    // Gym
    createGym,
    updateGym,
    deleteGym,
    getGymDetails,
    addPackage,
    updatePackage,
    updateMembership,
    // Subscription
    assignSubscription,
    getStudentSubscription,
    useSession,
    getStudentBalance,
    // Payment
    createPaymentRequest,
    approvePayment,
    rejectPayment,
    getPaymentRequests,
    // Measurement
    createMeasurement,
    getMeasurements,
    getLatestMeasurement,
    // ParQ
    createParQTest,
    getParQTests,
    getLatestParQTest,
    // Schedule
    assignWorkoutSchedule,
    updateWorkoutSchedule,
    deleteWorkoutSchedule,
    getStudentSchedule,
    toggleScheduleStatus,
    // Application Features
    createGymTypes,
    createAmenities,
    createSocialMediaTypes,
    deleteAmenities,
    deleteGymTypes,
    deleteSocialMediaTypes
};