import { setGlobalOptions } from "firebase-functions/v2";

// Clean module imports using barrel exports
import { registerStudent, assignCoach, joinGym, updateStudentProfile, deleteStudentAccount } from "./student";
import { registerCoach, coachJoinGym, updateCoachProfile, deleteCoachAccount, removeCoachFromGym } from "./coach";
import { createAdmin, updateAdmin, deleteAdmin, deleteAdminAccount } from "./admin";
import { registerSuperAdmin, migrateGymClaims } from "./superadmin";
import { createGym, updateGym, deleteGym, getGymDetails, addPackage, updatePackage, deletePackage, updateMembershipPlan, addMembershipPlan, deleteMembershipPlan, addAmenity, deleteAmenity } from "./gym";
import { assignSubscription, getStudentSubscription, useSession, getStudentBalance, cancelSubscription } from "./subscription";
import { createPaymentRequest, approvePayment, rejectPayment, getPaymentRequests } from "./payment";
import { createMeasurement, getMeasurements, getLatestMeasurement } from "./measurement";
import { createParQTest, getParQTests, getLatestParQTest } from "./parq";
import { assignWorkoutSchedule, updateWorkoutSchedule, deleteWorkoutSchedule, getStudentSchedule, toggleScheduleStatus, createAppointments, updateAppointmentsPlan, deleteAppointmentsPlan, completeAppointment, postponeAppointment, cancelAppointment, checkCommitmentExpiry, checkSubscriptionExpiry, getCoachSchedules } from "./schedule";
import { createGymTypes, createAmenities, createSocialMediaTypes, deleteAmenities, deleteGymTypes, deleteSocialMediaTypes } from "./applicationFeatures";
import { getSuperAdminLogs, getAdminLogs, getSuperAdminErrorLogs } from "./log";
import { resetPassword } from "./auth";
import { sendSessionReminder, getMyNotifications, markNotificationAsRead } from "./notification";
import { gymCheckIn, gymCheckOut } from "./gymPresence";

// Global ayarlar
setGlobalOptions({ maxInstances: 10, enforceAppCheck: true });

// Export functions
export {
    // Student
    registerStudent,
    assignCoach,
    joinGym,
    updateStudentProfile,
    deleteStudentAccount,
    // Coach
    registerCoach,
    coachJoinGym,
    updateCoachProfile,
    deleteCoachAccount,
    removeCoachFromGym,
    // Admin
    createAdmin,
    updateAdmin,
    deleteAdmin,
    deleteAdminAccount,
    // SuperAdmin
    registerSuperAdmin,
    migrateGymClaims,
    // Gym
    createGym,
    updateGym,
    deleteGym,
    getGymDetails,
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
};