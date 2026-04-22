import { setGlobalOptions } from "firebase-functions/v2";

// Hot path: iOS app'in açılışta ve ana ekranlarda sık çağırdığı fonksiyonlar.
// Cold-only modülleri (schedule create/update, admin CRUD, payment approval, vs.)
// import etmiyoruz — tsc `files` entry'si import graph'ını izler ve sadece bu
// fonksiyonların transitif bağımlılıklarını derler.

// Common
import { ping } from "../../functions/src/common/functions/ping";

// Notification
import { getMyNotifications } from "../../functions/src/notification/functions/getMyNotifications";
import { markNotificationAsRead } from "../../functions/src/notification/functions/markNotificationAsRead";

// Subscription
import { getStudentBalance } from "../../functions/src/subscription/functions/getStudentBalance";
import { getStudentSubscription } from "../../functions/src/subscription/functions/getStudentSubscription";

// Gym Presence
import { gymCheckIn } from "../../functions/src/gymPresence/functions/gymCheckIn";
import { gymCheckOut } from "../../functions/src/gymPresence/functions/gymCheckOut";
import { getGymPresence } from "../../functions/src/gymPresence/functions/getGymPresence";

// Profile lookups
import { getStudentById } from "../../functions/src/student/functions/getStudentById";
import { getCoachById } from "../../functions/src/coach/functions/getCoachById";
import { getGymDetails } from "../../functions/src/gym/functions/getGymDetails";

setGlobalOptions({ maxInstances: 10, enforceAppCheck: true });

export {
    ping,
    getMyNotifications,
    markNotificationAsRead,
    getStudentBalance,
    getStudentSubscription,
    gymCheckIn,
    gymCheckOut,
    getGymPresence,
    getStudentById,
    getCoachById,
    getGymDetails,
};
