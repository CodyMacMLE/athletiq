import { usersSchema } from "./modules/users/schema.js";
import { organizationsSchema } from "./modules/organizations/schema.js";
import { teamsSchema } from "./modules/teams/schema.js";
import { eventsSchema } from "./modules/events/schema.js";
import { attendanceSchema } from "./modules/attendance/schema.js";
import { analyticsSchema } from "./modules/analytics/schema.js";
import { rolesSchema } from "./modules/roles/schema.js";
import { gamificationSchema } from "./modules/gamification/schema.js";
import { communicationsSchema } from "./modules/communications/schema.js";
import { healthSchema } from "./modules/health/schema.js";
import { guardianSchema } from "./modules/guardian/schema.js";
import { mediaSchema } from "./modules/media/schema.js";
import { paymentsSchema } from "./modules/payments/schema.js";
import { subscriptionsSchema } from "./modules/subscriptions/schema.js";

const baseSchema = `#graphql
  type Query
  type Mutation
`;

export const typeDefs = [
  baseSchema,
  usersSchema,
  organizationsSchema,
  teamsSchema,
  eventsSchema,
  attendanceSchema,
  analyticsSchema,
  rolesSchema,
  gamificationSchema,
  communicationsSchema,
  healthSchema,
  guardianSchema,
  mediaSchema,
  paymentsSchema,
  subscriptionsSchema,
];
