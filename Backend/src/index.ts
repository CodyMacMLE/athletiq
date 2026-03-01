import { ApolloServer } from "@apollo/server";
import type { GraphQLFormattedError } from "graphql";
import { ApolloServerPluginLandingPageLocalDefault } from "@apollo/server/plugin/landingPage/default";
import { expressMiddleware } from "@as-integrations/express5";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import depthLimit from "graphql-depth-limit";
import { CognitoJwtVerifier } from "aws-jwt-verify";
import { typeDefs } from "./schema.js";
import { resolvers } from "./resolvers/index.js";
import { prisma } from "./db.js";
import { createLoaders, Loaders } from "./utils/dataLoaders.js";
import { startAbsentMarkerCron, stopAbsentMarkerCron } from "./cron/absentMarker.js";
import { startAutoCheckoutCron, stopAutoCheckoutCron } from "./cron/autoCheckout.js";
import { startEventReminderCron, stopEventReminderCron } from "./cron/eventReminders.js";
import { startEmailReportCron, stopEmailReportCron } from "./cron/emailReportScheduler.js";
import { startScheduledAnnouncementCron, stopScheduledAnnouncementCron } from "./cron/scheduledAnnouncements.js";
import Stripe from "stripe";
import { userRateLimiter } from "./utils/rateLimit.js";
import { auditLog } from "./utils/audit.js";
import { logger, captureError } from "./utils/logger.js";
import { handleSubscriptionWebhook } from "./modules/subscriptions/resolvers.js";

interface Context {
  userId?: string;
  loaders: Loaders;
}

// Verify Cognito ID tokens (signature + expiry + issuer + audience)
const cognitoVerifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID || "us-east-2_jHLnfwOqy",
  tokenUse: "id",
  clientId: process.env.COGNITO_CLIENT_ID || "3e0jmpi1vpsbkntof8h6u7eov0",
});

const isProd = process.env.NODE_ENV === "production";

// ─── CORS allowlist ────────────────────────────────────────────────────────────
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:4000",
  ...(process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim()) : []),
];

// Rate limiter — 120 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { errors: [{ message: "Too many requests, please try again later." }] },
});

// Basic Auth middleware — only applies to GET requests (playground page load).
// POST requests (actual GraphQL queries) skip this and use Cognito JWT instead.
function playgroundAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (req.method !== "GET") return next();

  const playgroundPassword = process.env.PLAYGROUND_PASSWORD;
  if (!playgroundPassword) {
    res.status(403).send("Playground is disabled (PLAYGROUND_PASSWORD not set)");
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="GraphQL Playground"');
    res.status(401).send("Authentication required");
    return;
  }

  const credentials = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
  const colonIndex = credentials.indexOf(":");
  const username = credentials.slice(0, colonIndex);
  const password = credentials.slice(colonIndex + 1);

  const validUsername = process.env.PLAYGROUND_USERNAME || "admin";
  if (username !== validUsername || password !== playgroundPassword) {
    res.setHeader("WWW-Authenticate", 'Basic realm="GraphQL Playground"');
    res.status(401).send("Invalid credentials");
    return;
  }

  next();
}

async function main() {
  const app = express();

  // Trust the ALB/reverse-proxy so express-rate-limit and req.ip work correctly
  // with the X-Forwarded-For header set by AWS ALB.
  app.set("trust proxy", 1);

  const server = new ApolloServer<Context>({
    typeDefs,
    resolvers,
    // Disable introspection in production to avoid leaking schema to attackers
    introspection: !isProd,
    // Mask internal error details in production (no stack traces in responses)
    formatError: (formattedError: GraphQLFormattedError, error: unknown) => {
      if (isProd) {
        // Preserve validation errors and explicit user-facing errors
        if (formattedError.extensions?.code === "GRAPHQL_VALIDATION_FAILED") {
          return formattedError;
        }
        if (
          formattedError.message.startsWith("Validation error:") ||
          formattedError.message.startsWith("Authentication required") ||
          formattedError.message.startsWith("Not authorized") ||
          formattedError.message.startsWith("Cannot delete") ||
          formattedError.message.startsWith("You must ")
        ) {
          return { message: formattedError.message };
        }
        // Log the real error to CloudWatch before masking it
        logger.error({ err: error, msg: formattedError.message }, "GraphQL internal error");
        return { message: "Internal server error" };
      }
      return formattedError;
    },
    validationRules: [
      // Prevent deeply nested queries that cause exponential DB load
      depthLimit(10),
    ],
    plugins: [
      ...(!isProd ? [ApolloServerPluginLandingPageLocalDefault({ embed: true })] : []),
    ],
  });

  await server.start();

  // Helmet — HTTP security headers (CSP, HSTS, X-Frame-Options, MIME sniff prevention, etc.)
  // Disable contentSecurityPolicy for the GraphQL playground iframe to load correctly in dev.
  app.use(helmet({ contentSecurityPolicy: isProd }));

  // ─── Health endpoints ────────────────────────────────────────────────────────
  // GET /health  — fast liveness (ECS health check, no DB hit)
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", uptime: process.uptime() });
  });

  // GET /health/ready — deep readiness check (DB connectivity)
  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready", db: "ok" });
    } catch (err) {
      res.status(503).json({ status: "not ready", db: "unreachable" });
    }
  });

  // ─── Stripe webhook — MUST be raw body, before express.json() ────────────────
  const stripeClient = process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-02-25.clover" })
    : null;

  app.post("/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripeClient || !process.env.STRIPE_WEBHOOK_SECRET) {
      res.status(400).json({ error: "Stripe not configured" });
      return;
    }
    const sig = req.headers["stripe-signature"];
    let event: Stripe.Event;
    try {
      event = stripeClient.webhooks.constructEvent(req.body, sig as string, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      logger.warn({ err: err.message }, "Stripe webhook signature verification failed");
      res.status(400).json({ error: `Webhook error: ${err.message}` });
      return;
    }

    if (event.type === "payment_intent.succeeded") {
      const intent = event.data.object as Stripe.PaymentIntent;
      const invoiceId = intent.metadata?.invoiceId;
      if (invoiceId) {
        try {
          await prisma.$transaction(async (tx) => {
            const invoice = await tx.invoice.findUnique({
              where: { id: invoiceId },
              include: { payments: { select: { amountCents: true } } },
            });
            if (!invoice) return;
            // Avoid double-recording — check if a Stripe payment already exists for this intent
            const existing = await tx.payment.findFirst({
              where: { invoiceId, stripePaymentIntentId: intent.id },
            });
            if (existing) return;
            const totalPaid = invoice.payments.reduce((s, p) => s + p.amountCents, 0);
            const amountCents = intent.amount_received;
            await tx.payment.create({
              data: {
                invoiceId,
                organizationId: invoice.organizationId,
                userId: invoice.userId,
                amountCents,
                currency: invoice.currency,
                method: "STRIPE",
                stripePaymentIntentId: intent.id,
                stripeChargeId: (intent.latest_charge as string) ?? undefined,
                paidAt: new Date(),
                recordedBy: invoice.userId, // self-payment
              },
            });
            if (totalPaid + amountCents >= invoice.amountCents) {
              await tx.invoice.update({
                where: { id: invoiceId },
                data: { status: "PAID", paidAt: new Date() },
              });
            }
          });
          logger.info({ intentId: intent.id, invoiceId }, "Stripe payment recorded");
        } catch (err) {
          captureError(err, { event: event.type, intentId: intent.id });
        }
      }
    }

    // account.updated — fired when an Express account completes onboarding.
    // Mark stripeAccountEnabled=true once charges_enabled flips to true.
    if (event.type === "account.updated") {
      const account = event.data.object as Stripe.Account;
      if (account.charges_enabled) {
        try {
          await prisma.organization.updateMany({
            where: { stripeAccountId: account.id },
            data: { stripeAccountEnabled: true },
          });
          logger.info({ accountId: account.id }, "Stripe Connect account enabled");
        } catch (err) {
          captureError(err, { event: event.type, accountId: account.id });
        }
      }
    }

    // Subscription lifecycle events (checkout, renewal, failure, cancellation)
    const subscriptionHandled = await handleSubscriptionWebhook(event).catch((err) => {
      captureError(err, { event: event.type });
      return false;
    });
    if (!subscriptionHandled && event.type !== "payment_intent.succeeded" && event.type !== "account.updated") {
      logger.debug({ eventType: event.type }, "Unhandled Stripe event");
    }

    res.json({ received: true });
  });

  app.use(
    "/graphql",
    cors<cors.CorsRequest>({
      origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, server-to-server)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        callback(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
    express.json(),
    apiLimiter,
    playgroundAuth,
    expressMiddleware(server, {
      context: async ({ req }) => {
        // Playground API key bypass — allows testing in Apollo Studio without a Cognito JWT.
        // Only works when PLAYGROUND_API_KEY is set in the environment.
        const apiKey = req.headers["x-api-key"];
        const playgroundApiKey = process.env.PLAYGROUND_API_KEY;
        const loaders = createLoaders();

        if (apiKey && playgroundApiKey && apiKey === playgroundApiKey) {
          const email = process.env.PLAYGROUND_USER_EMAIL;
          if (!email) throw new Error("PLAYGROUND_USER_EMAIL is not set");
          const user = await prisma.user.findUnique({ where: { email } });
          if (!user) throw new Error(`No user found for PLAYGROUND_USER_EMAIL: ${email}`);
          logger.info({ userId: user.id, email }, "[playground] authenticated");
          return { userId: user.id, loaders };
        }

        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith("Bearer ")) {
          return { loaders };
        }

        const token = authHeader.slice(7);

        let payload: Record<string, unknown>;
        try {
          payload = await cognitoVerifier.verify(token) as Record<string, unknown>;
        } catch {
          // Token invalid, expired, or tampered — treat as unauthenticated
          return { loaders };
        }

        if (typeof payload.email !== "string") return { loaders };

        let user = await prisma.user.findUnique({ where: { email: payload.email } });

        // Auto-create DB record for authenticated Cognito users
        if (!user) {
          user = await prisma.user.create({
            data: {
              email: payload.email,
              firstName: (payload.given_name as string) || payload.email.split("@")[0],
              lastName: (payload.family_name as string) || "",
            },
          });
        }

        // Per-user rate limiting — checked after we know who the user is
        const rateLimitResult = userRateLimiter.check(user.id);
        if (rateLimitResult) {
          // Emit audit log entry for suspicious activity
          auditLog({
            action: "SUSPICIOUS_ACTIVITY",
            actorId: user.id,
            targetId: user.id,
            targetType: "User",
            organizationId: undefined,
            metadata: { reason: "per-user rate limit exceeded" },
          }).catch(() => {});
          const retryAfterSec = Math.ceil(rateLimitResult.retryAfterMs / 1000);
          throw Object.assign(new Error("Too many requests. Please slow down."), {
            extensions: { code: "RATE_LIMITED", retryAfter: retryAfterSec },
          });
        }

        // Successful auth — reset failed auth counter
        userRateLimiter.resetFailedAuth(user.email);

        return { userId: user.id, loaders };
      },
    })
  );

  const httpServer = app.listen(4000, "0.0.0.0", () => {
    logger.info("🚀 Server ready at http://localhost:4000/graphql");
    startAbsentMarkerCron();
    startAutoCheckoutCron();
    startEventReminderCron();
    startEmailReportCron();
    startScheduledAnnouncementCron();
  });

  // Graceful shutdown — stop accepting new requests, drain in-flight, then exit.
  // ECS sends SIGTERM before forcibly killing (default 30s grace period).
  async function shutdown(signal: string) {
    logger.info({ signal }, "Received shutdown signal — draining in-flight requests...");
    stopAbsentMarkerCron();
    stopAutoCheckoutCron();
    stopEventReminderCron();
    stopEmailReportCron();
    stopScheduledAnnouncementCron();

    httpServer.close(async () => {
      logger.info("HTTP server closed. Disconnecting Prisma...");
      await prisma.$disconnect();
      logger.info("Shutdown complete.");
      process.exit(0);
    });

    // Force-exit after 25s if drain takes too long (ECS kills at 30s)
    setTimeout(() => {
      logger.error("Drain timeout — forcing exit.");
      process.exit(1);
    }, 25_000).unref();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch(async (e) => {
  logger.fatal({ err: e }, "Unhandled error during startup");
  captureError(e, { context: "startup" });
  await prisma.$disconnect();
  process.exit(1);
});
