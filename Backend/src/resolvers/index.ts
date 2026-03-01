import { userResolvers } from "../modules/users/resolvers.js";
import { organizationResolvers } from "../modules/organizations/resolvers.js";
import { teamResolvers } from "../modules/teams/resolvers.js";
import { eventResolvers } from "../modules/events/resolvers.js";
import { attendanceResolvers } from "../modules/attendance/resolvers.js";
import { analyticsResolvers } from "../modules/analytics/resolvers.js";
import { rolesResolvers } from "../modules/roles/resolvers.js";
import { gamificationResolvers } from "../modules/gamification/resolvers.js";
import { communicationsResolvers } from "../modules/communications/resolvers.js";
import { healthResolvers } from "../modules/health/resolvers.js";
import { guardianResolvers } from "../modules/guardian/resolvers.js";
import { mediaResolvers } from "../modules/media/resolvers.js";
import { paymentsResolvers } from "../modules/payments/resolvers.js";
import { subscriptionsResolvers } from "../modules/subscriptions/resolvers.js";

// Deep-merge all module resolvers into a single resolvers map.
// Each module exports Query/Mutation sub-keys plus field resolver type keys.
function mergeResolvers(...modules: Record<string, any>[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const mod of modules) {
    for (const [key, value] of Object.entries(mod)) {
      if (result[key] && typeof result[key] === "object" && typeof value === "object") {
        result[key] = { ...result[key], ...(value as Record<string, any>) };
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

export const resolvers = mergeResolvers(
  userResolvers,
  organizationResolvers,
  teamResolvers,
  eventResolvers,
  attendanceResolvers,
  analyticsResolvers,
  rolesResolvers,
  gamificationResolvers,
  communicationsResolvers,
  healthResolvers,
  guardianResolvers,
  mediaResolvers,
  paymentsResolvers,
  subscriptionsResolvers,
);
