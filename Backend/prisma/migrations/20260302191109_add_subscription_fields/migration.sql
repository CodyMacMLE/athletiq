-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('STARTER', 'GROWTH', 'PRO');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "BillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "athleteLimit" INTEGER NOT NULL DEFAULT 75,
ADD COLUMN     "billingCurrency" TEXT NOT NULL DEFAULT 'cad',
ADD COLUMN     "billingPeriod" "BillingPeriod" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "currentPeriodEnd" TIMESTAMP(3),
ADD COLUMN     "stripeCustomerId" TEXT,
ADD COLUMN     "stripeSubscriptionId" TEXT,
ADD COLUMN     "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
ADD COLUMN     "subscriptionTier" "SubscriptionTier" NOT NULL DEFAULT 'STARTER',
ADD COLUMN     "trialEndsAt" TIMESTAMP(3);
