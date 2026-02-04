import { setGlobalOptions } from "firebase-functions/v2";

// Import modules
import { registerStudent } from "./student/register";
import { assignCoach } from "./student/assignCoach";
import { createCoach } from "./admin/createCoach";
// import { registerAdmin } from "./admin/register"; // Removed

// Superadmin functions
import { registerSuperAdmin } from "./superadmin/register";
import { createAdmin } from "./superadmin/createAdmin";

// Global ayarlar
setGlobalOptions({ maxInstances: 10 });

// Export functions
export {
    registerStudent,
    assignCoach,
    createCoach,
    // registerAdmin, // Removed
    registerSuperAdmin,
    createAdmin
};