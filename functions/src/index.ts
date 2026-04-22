import { setGlobalOptions } from "firebase-functions/v2";

// Clean module imports using barrel exports.
// NOT: iOS hot path fonksiyonları (ping, getMyNotifications, markNotificationAsRead,
// getStudentBalance, getStudentSubscription, gymCheckIn, gymCheckOut, getGymPresence,
// getStudentById, getCoachById, getGymDetails) ayrı bir codebase'e (functions-hot)
// taşındı — cold start süresini azaltmak için. Bkz: ../../functions-hot/src/index.ts
import { getMyProfile } from "./common/functions/getMyProfile";
import { registerStudent, assignCoach, joinGym, updateStudentProfile, deleteStudentAccount, getGymMembers, getCoachMembers } from "./student";
import { registerCoach, coachJoinGym, updateCoachProfile, deleteCoachAccount, removeCoachFromGym, getGymCoaches } from "./coach";
import { registerAdmin, createAdmin, updateAdmin, deleteAdmin, deleteAdminAccount } from "./admin";
import { registerSuperAdmin } from "./superadmin";
import { createGym, updateGym, deleteGym, getOwnerGyms, addPackage, updatePackage, deletePackage, updateMembershipPlan, addMembershipPlan, deleteMembershipPlan, addAmenity, deleteAmenity } from "./gym";
import { assignSubscription, useSession, cancelSubscription } from "./subscription";
import { createPaymentRequest, approvePayment, rejectPayment, getPaymentRequests } from "./payment";
import { createMeasurement, getMeasurements, getLatestMeasurement } from "./measurement";
import { createParQTest, getParQTests, getLatestParQTest } from "./parq";
import { assignWorkoutSchedule, updateWorkoutSchedule, deleteWorkoutSchedule, getStudentSchedule, toggleScheduleStatus, createAppointments, updateAppointmentsPlan, deleteAppointmentsPlan, completeAppointment, postponeAppointment, cancelAppointment, checkCommitmentExpiry, checkSubscriptionExpiry, getCoachSchedules } from "./schedule";
import { createGymTypes, createAmenities, createSocialMediaTypes, deleteAmenities, deleteGymTypes, deleteSocialMediaTypes, getApplicationFeatures } from "./applicationFeatures";
import { getSuperAdminLogs, getAdminLogs, getSuperAdminErrorLogs } from "./log";
import { resetPassword } from "./auth";
import { sendSessionReminder } from "./notification";

// Global ayarlar
setGlobalOptions({ maxInstances: 10, enforceAppCheck: true });

// Export functions
export {
    // Common
    getMyProfile,
    // Student
    registerStudent,
    assignCoach,
    joinGym,
    updateStudentProfile,
    deleteStudentAccount,
    getGymMembers,
    getCoachMembers,
    // Coach
    registerCoach,
    coachJoinGym,
    updateCoachProfile,
    deleteCoachAccount,
    removeCoachFromGym,
    getGymCoaches,
    // Admin
    registerAdmin,
    createAdmin,
    updateAdmin,
    deleteAdmin,
    deleteAdminAccount,
    // SuperAdmin
    registerSuperAdmin,
    // Gym
    createGym,
    updateGym,
    deleteGym,
    getOwnerGyms,
    addPackage,
    updatePackage,
    deletePackage,
    addMembershipPlan,
    updateMembershipPlan,
    deleteMembershipPlan,
    addAmenity,
    deleteAmenity,
    // Subscription
    assignSubscription,
    useSession,
    cancelSubscription,
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
    getCoachSchedules,
    toggleScheduleStatus,
    createAppointments,
    updateAppointmentsPlan,
    deleteAppointmentsPlan,
    completeAppointment,
    postponeAppointment,
    cancelAppointment,

    //Scheduled
    checkCommitmentExpiry,
    checkSubscriptionExpiry,

    // Application Features
    createGymTypes,
    createAmenities,
    createSocialMediaTypes,
    deleteAmenities,
    deleteGymTypes,
    deleteSocialMediaTypes,
    getApplicationFeatures,
    // Logs
    getSuperAdminLogs,
    getAdminLogs,
    getSuperAdminErrorLogs,
    // Auth
    resetPassword,
    // Notification (only scheduled)
    sendSessionReminder,
};