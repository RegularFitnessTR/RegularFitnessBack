import { setGlobalOptions } from "firebase-functions/v2";

// Clean module imports using barrel exports
import { getMyProfile } from "./common";
import { registerStudent, assignCoach, joinGym, updateStudentProfile, deleteStudentAccount, getStudentById, getGymMembers, getCoachMembers } from "./student";
import { registerCoach, coachJoinGym, updateCoachProfile, deleteCoachAccount, removeCoachFromGym, getCoachById, getGymCoaches } from "./coach";
import { registerAdmin, createAdmin, updateAdmin, deleteAdmin, deleteAdminAccount } from "./admin";
import { registerSuperAdmin } from "./superadmin";
import { createGym, updateGym, deleteGym, getGymDetails, getOwnerGyms, addPackage, updatePackage, deletePackage, updateMembershipPlan, addMembershipPlan, deleteMembershipPlan, addAmenity, deleteAmenity } from "./gym";
import { assignSubscription, getStudentSubscription, useSession, getStudentBalance, cancelSubscription } from "./subscription";
import { createPaymentRequest, approvePayment, rejectPayment, getPaymentRequests } from "./payment";
import { createMeasurement, getMeasurements, getLatestMeasurement } from "./measurement";
import { createParQTest, getParQTests, getLatestParQTest } from "./parq";
import { assignWorkoutSchedule, updateWorkoutSchedule, deleteWorkoutSchedule, getStudentSchedule, toggleScheduleStatus, createAppointments, updateAppointmentsPlan, deleteAppointmentsPlan, completeAppointment, postponeAppointment, cancelAppointment, checkCommitmentExpiry, checkSubscriptionExpiry, getCoachSchedules } from "./schedule";
import { createGymTypes, createAmenities, createSocialMediaTypes, deleteAmenities, deleteGymTypes, deleteSocialMediaTypes, getApplicationFeatures } from "./applicationFeatures";
import { getSuperAdminLogs, getAdminLogs, getSuperAdminErrorLogs } from "./log";
import { resetPassword } from "./auth";
import { sendSessionReminder, getMyNotifications, markNotificationAsRead } from "./notification";
import { gymCheckIn, gymCheckOut, getGymPresence } from "./gymPresence";

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
    getStudentById,
    getGymMembers,
    getCoachMembers,
    // Coach
    registerCoach,
    coachJoinGym,
    updateCoachProfile,
    deleteCoachAccount,
    removeCoachFromGym,
    getCoachById,
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
    getGymDetails,
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
    getStudentSubscription,
    useSession,
    getStudentBalance,
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
    // Notification
    sendSessionReminder,
    getMyNotifications,
    markNotificationAsRead,
    // Gym Presence
    gymCheckIn,
    gymCheckOut,
    getGymPresence,
};