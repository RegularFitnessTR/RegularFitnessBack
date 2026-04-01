import { setGlobalOptions } from "firebase-functions/v2";

// Clean module imports using barrel exports
import { registerStudent, assignCoach, joinGym, updateStudentProfile } from "./student";
import { createCoach, updateCoach, deleteCoach, updateCoachProfile } from "./coach";
import { createAdmin, updateAdmin, deleteAdmin } from "./admin";
import { registerSuperAdmin } from "./superadmin";
import { createGym, updateGym, deleteGym, getGymDetails, addPackage, updatePackage, deletePackage, updateMembershipPlan, addMembershipPlan, deleteMembershipPlan, addAmenity, deleteAmenity } from "./gym";
import { assignSubscription, getStudentSubscription, useSession, getStudentBalance, cancelSubscription } from "./subscription";
import { createPaymentRequest, approvePayment, rejectPayment, getPaymentRequests } from "./payment";
import { createMeasurement, getMeasurements, getLatestMeasurement } from "./measurement";
import { createParQTest, getParQTests, getLatestParQTest } from "./parq";
import { assignWorkoutSchedule, updateWorkoutSchedule, deleteWorkoutSchedule, getStudentSchedule, toggleScheduleStatus, createAppointments, completeAppointment, postponeAppointment, cancelAppointment, checkCommitmentExpiry, checkSubscriptionExpiry, getCoachSchedules } from "./schedule";
import { createGymTypes, createAmenities, createSocialMediaTypes, deleteAmenities, deleteGymTypes, deleteSocialMediaTypes } from "./applicationFeatures";
import { getSuperAdminLogs, getAdminLogs, getSuperAdminErrorLogs } from "./log";
import { resetPassword } from "./auth";
import { sendSessionReminder, getMyNotifications, markNotificationAsRead } from "./notification";

// Global ayarlar
setGlobalOptions({ maxInstances: 10 });

// Export functions
export {
    // Student
    registerStudent,
    assignCoach,
    joinGym,
    updateStudentProfile,
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
    markNotificationAsRead
};