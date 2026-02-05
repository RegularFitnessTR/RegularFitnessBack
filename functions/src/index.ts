import { setGlobalOptions } from "firebase-functions/v2";

// Clean module imports using barrel exports
import { registerStudent, assignCoach } from "./student";
import { createCoach, updateCoach, deleteCoach } from "./coach";
import { createAdmin, updateAdmin, deleteAdmin } from "./admin";
import { registerSuperAdmin } from "./superadmin";
import { createGym, updateGym, deleteGym, getGymDetails } from "./gym";

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
    getGymDetails
};