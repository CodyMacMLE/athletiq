"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@apollo/client/react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  User,
  Check,
  Zap,
  Trophy,
  BarChart2,
  Loader2,
} from "lucide-react";
import {
  cognitoSignUp,
  cognitoSignIn,
  cognitoConfirmSignUp,
  cognitoResendSignUpCode,
} from "@/lib/cognito";
import { CREATE_USER, CREATE_ORGANIZATION } from "@/lib/graphql";
import { useMutation as useApolloMutation } from "@apollo/client/react";
import { gql } from "@apollo/client";

const CREATE_ORG_SUBSCRIPTION = gql`
  mutation CreateOrgSubscription(
    $organizationId: ID!
    $tier: SubscriptionTier!
    $currency: String!
    $billingPeriod: BillingPeriod
  ) {
    createOrgSubscription(
      organizationId: $organizationId
      tier: $tier
      currency: $currency
      billingPeriod: $billingPeriod
    ) {
      checkoutUrl
    }
  }
`;

// ─── Styles ───────────────────────────────────────────────────────────────────

const inputClass =
  "w-full px-4 py-3 bg-white/8 border border-white/10 rounded-lg text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#6c5ce7] focus:border-transparent";
const labelClass = "block text-xs font-medium text-white/55 mb-1.5";
const gradientStyle = {
  background: "linear-gradient(160deg, #302b6f 10%, #4d2a69 60%, #302b6f 100%)",
};

// ─── Plans ────────────────────────────────────────────────────────────────────

/**
 * Detect billing currency from browser locale.
 * "en-CA", "fr-CA", etc. → CAD.  Everything else → USD.
 * Used client-side only; SSR will default to USD (no window).
 */
function detectCurrency(): "CAD" | "USD" {
  if (typeof navigator === "undefined") return "USD";
  const lang = navigator.language ?? "";
  return lang.toLowerCase().endsWith("-ca") ? "CAD" : "USD";
}

const PRICES = {
  STARTER: { CAD: "$80", USD: "$59" },
  GROWTH:  { CAD: "$200", USD: "$149" },
  PRO:     { CAD: "$450", USD: "$329" },
} as const;

const PLANS = [
  {
    id: "STARTER" as const,
    name: "Starter",
    athleteLimit: 75,
    description: "For clubs getting started with digital attendance.",
    Icon: Zap,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-500/20",
    features: [
      "Up to 75 athletes",
      "Unlimited teams",
      "Event scheduling & NFC check-ins",
      "Basic attendance tracking",
      "Guardian access & email reports",
      "Mobile app access",
    ],
    ctaLabel: "Start 14-Day Free Trial",
    trialNote: "14-day free trial — card required. Cancel anytime.",
  },
  {
    id: "GROWTH" as const,
    name: "Growth",
    athleteLimit: 200,
    description: "For growing organizations needing deeper insights.",
    Icon: BarChart2,
    iconColor: "text-purple-400",
    iconBg: "bg-purple-500/20",
    features: [
      "Up to 200 athletes",
      "Everything in Starter",
      "Advanced analytics & trends",
      "Season-over-season comparisons",
      "Leaderboards & CSV exports",
      "Priority support",
    ],
    ctaLabel: "Start 14-Day Free Trial",
    trialNote: "14-day free trial — card required. Cancel anytime.",
  },
  {
    id: "PRO" as const,
    name: "Pro",
    athleteLimit: 500,
    description: "For elite programs that need every edge.",
    Icon: Trophy,
    iconColor: "text-yellow-400",
    iconBg: "bg-yellow-500/20",
    features: [
      "Up to 500 athletes",
      "Everything in Growth",
      "AI at-risk athlete detection",
      "Advanced reporting suite",
      "Custom roles & permissions",
      "Dedicated account manager",
    ],
    ctaLabel: "Start 14-Day Free Trial",
    trialNote: "14-day free trial — card required. Cancel anytime.",
  },
] as const;

type PlanId = "STARTER" | "GROWTH" | "PRO";
type AccountType = "user" | "org";

// ─── Step labels ──────────────────────────────────────────────────────────────

const ORG_STEP_LABELS  = ["Your Account", "Organization", "Choose Plan", "Verify Email"];
const USER_STEP_LABELS = ["Your Account", "Verify Email"];

// ─── Shared sub-components ────────────────────────────────────────────────────

function ProgressBar({
  labels,
  activeIndex,
}: {
  labels: readonly string[];
  activeIndex: number;
}) {
  return (
    <div className="flex items-start gap-2 mb-6">
      {labels.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1.5">
          <div
            className={`h-1 w-full rounded-full transition-colors ${
              i < activeIndex
                ? "bg-[#6c5ce7]"
                : i === activeIndex
                ? "bg-[#a78bfa]"
                : "bg-white/10"
            }`}
          />
          <span
            className={`text-[10px] font-medium text-center leading-tight transition-colors ${
              i === activeIndex
                ? "text-[#a78bfa]"
                : i < activeIndex
                ? "text-[#6c5ce7]"
                : "text-white/25"
            }`}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 text-sm text-white/45 hover:text-white transition-colors mb-6"
    >
      <ArrowLeft className="w-4 h-4" /> Back
    </button>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm">
      {message}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegisterPage() {
  const router = useRouter();

  // Which top-level path
  const [accountType, setAccountType] = useState<AccountType | null>(null);

  // Step indices (0 = type selection; higher = flow steps)
  // User:  1=account details, 2=verify
  // Org:   1=account details, 2=org details, 3=plan, 4=verify
  const [orgStep,  setOrgStep]  = useState(0);
  const [userStep, setUserStep] = useState(0);

  // Currency detection (client-side only — default USD avoids hydration mismatch)
  const [currency, setCurrency] = useState<"CAD" | "USD">("USD");
  useState(() => { setCurrency(detectCurrency()); });

  // Form data
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    confirmEmail: "",
    password: "",
    confirmPassword: "",
  });
  const [orgName, setOrgName] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("STARTER");
  const [confirmationCode, setConfirmationCode] = useState("");
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);

  // UI state
  const [error,     setError]     = useState("");
  const [loading,   setLoading]   = useState(false);
  const [stepLabel, setStepLabel] = useState("");
  const [resending, setResending] = useState(false);

  const [createUser]            = useMutation<any>(CREATE_USER);
  const [createOrganization]    = useMutation<any>(CREATE_ORGANIZATION);
  const [createOrgSubscription] = useApolloMutation<{
    createOrgSubscription: { checkoutUrl: string };
  }>(CREATE_ORG_SUBSCRIPTION);

  // ── Helpers ────────────────────────────────────────────────────────────────

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError("");
  }

  function goToType() {
    setAccountType(null);
    setOrgStep(0);
    setUserStep(0);
    setError("");
  }

  // ── Account details submit → Cognito signup → advance to verify ────────────

  async function handleAccountDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const { firstName, lastName, email, confirmEmail, password, confirmPassword } = form;
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !confirmEmail.trim() || !password || !confirmPassword) {
      setError("Please fill in all fields.");
      return;
    }
    if (email.toLowerCase() !== confirmEmail.toLowerCase()) {
      setError("Email addresses do not match.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    setStepLabel("Creating account...");
    try {
      const result = await cognitoSignUp(email.trim(), password);
      if (!result.success) {
        const err = result.error || "";
        if (err.includes("already exists") || err.includes("UsernameExistsException")) {
          // The Cognito account may be unconfirmed (user abandoned mid-flow).
          // Try resending the code — if it succeeds, resume at the verify step.
          setStepLabel("Checking account status...");
          const resendResult = await cognitoResendSignUpCode(email.trim());
          if (resendResult.success) {
            // Unconfirmed account — resume the flow and surface a notice.
            setError("");
            setConfirmationCode("");
            if (accountType === "org") {
              // Still need org name + plan before verify; start at org details step
              setOrgStep(2);
            } else {
              setUserStep(2);
            }
            setStepLabel("A new verification code has been sent to your email.");
          } else {
            // Account is already confirmed — they should sign in
            setError("An account with this email already exists. Please sign in instead.");
          }
        } else {
          setError(err || "Failed to create account.");
        }
        setLoading(false);
        return;
      }
      // Advance to next step
      if (accountType === "org") setOrgStep(2);
      else setUserStep(2);
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  }

  // ── Email verification → sign in → create DB records → redirect ────────────

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!confirmationCode.trim()) {
      setError("Please enter the confirmation code.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      setStepLabel("Verifying email...");
      const confirmResult = await cognitoConfirmSignUp(form.email.trim(), confirmationCode.trim());
      if (!confirmResult.success) {
        if (!confirmResult.error?.includes("Current status is CONFIRMED")) {
          setError(confirmResult.error || "Invalid confirmation code.");
          setLoading(false);
          return;
        }
      }

      setStepLabel("Signing in...");
      const signInResult = await cognitoSignIn(form.email.trim(), form.password);
      if (!signInResult.success) {
        setError(signInResult.error || "Failed to sign in.");
        setLoading(false);
        return;
      }

      setStepLabel("Setting up your profile...");
      await createUser({
        variables: {
          input: {
            email: form.email.trim(),
            firstName: form.firstName.trim(),
            lastName: form.lastName.trim(),
          },
        },
      });

      if (accountType === "org") {
        setStepLabel("Creating organization...");
        const orgResult = await createOrganization({
          variables: { input: { name: orgName.trim() } },
        });
        const orgId = orgResult.data?.createOrganization?.id as string | undefined;

        if (orgId) {
          setStepLabel("Redirecting to billing...");
          const subResult = await createOrgSubscription({
            variables: {
              organizationId: orgId,
              tier: selectedPlan,
              currency: currency.toLowerCase(),
              billingPeriod: "MONTHLY",
            },
          });
          const checkoutUrl = subResult.data?.createOrgSubscription?.checkoutUrl;
          if (checkoutUrl) {
            window.location.href = checkoutUrl;
            return;
          }
        }
        // Fallback if Stripe not configured in dev
        router.push("/dashboard");
      } else {
        router.push("/account");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setLoading(false);
    }
  }

  async function handleResendCode() {
    setResending(true);
    setError("");
    const result = await cognitoResendSignUpCode(form.email.trim());
    if (!result.success) setError(result.error || "Failed to resend code.");
    setResending(false);
  }

  // ── STEP 0: Account type selection ─────────────────────────────────────────

  if (!accountType) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={gradientStyle}>
        <div className="w-full max-w-lg">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-white/45 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft className="w-4 h-4" /> Back to home
          </Link>

          <div className="text-center mb-8">
            <Link href="/">
              <Image
                src="/logo/white_icon_transparent_background.png"
                alt="AthletiQ"
                width={56}
                height={56}
                className="mx-auto mb-3"
              />
            </Link>
            <h1 className="text-2xl font-bold text-white">Get Started</h1>
            <p className="text-white/45 text-sm mt-1">How would you like to use AthletiQ?</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* User card */}
            <button
              onClick={() => { setAccountType("user"); setUserStep(1); }}
              className="group flex flex-col items-center gap-4 p-8 bg-white/5 border border-white/10 rounded-2xl hover:border-[#6c5ce7]/60 hover:bg-white/8 transition-all"
            >
              <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                <User className="w-8 h-8 text-blue-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">I&apos;m a Member</p>
                <p className="text-white/45 text-xs mt-1 leading-relaxed">
                  Join an organization with an invite link
                </p>
              </div>
            </button>

            {/* Organization card */}
            <button
              onClick={() => { setAccountType("org"); setOrgStep(1); }}
              className="group flex flex-col items-center gap-4 p-8 bg-white/5 border border-white/10 rounded-2xl hover:border-[#6c5ce7]/60 hover:bg-white/8 transition-all"
            >
              <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center group-hover:bg-purple-500/30 transition-colors">
                <Building2 className="w-8 h-8 text-purple-400" />
              </div>
              <div className="text-center">
                <p className="text-white font-semibold">I&apos;m an Organization</p>
                <p className="text-white/45 text-xs mt-1 leading-relaxed">
                  Register your team or club
                </p>
              </div>
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-white/40">
            Already have an account?{" "}
            <Link href="/signin" className="text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ── STEP 1 (both paths): Account details ───────────────────────────────────

  const isAccountStep =
    (accountType === "user" && userStep === 1) ||
    (accountType === "org" && orgStep === 1);

  if (isAccountStep) {
    const labels = accountType === "org" ? ORG_STEP_LABELS : USER_STEP_LABELS;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={gradientStyle}>
        <div className="w-full max-w-md">
          <BackBtn onClick={goToType} />
          <ProgressBar labels={labels} activeIndex={0} />

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8">
            <h1 className="text-xl font-bold text-white mb-1">Your Account</h1>
            <p className="text-white/45 text-sm mb-6">Create your personal login credentials.</p>

            <form onSubmit={handleAccountDetailsSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>First Name</label>
                  <input
                    type="text"
                    name="firstName"
                    required
                    value={form.firstName}
                    onChange={handleFormChange}
                    className={inputClass}
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className={labelClass}>Last Name</label>
                  <input
                    type="text"
                    name="lastName"
                    required
                    value={form.lastName}
                    onChange={handleFormChange}
                    className={inputClass}
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  name="email"
                  required
                  value={form.email}
                  onChange={handleFormChange}
                  className={inputClass}
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className={labelClass}>Confirm Email</label>
                <input
                  type="email"
                  name="confirmEmail"
                  required
                  value={form.confirmEmail}
                  onChange={handleFormChange}
                  className={`${inputClass} ${
                    form.confirmEmail && form.email.toLowerCase() !== form.confirmEmail.toLowerCase()
                      ? "ring-2 ring-red-500/50"
                      : ""
                  }`}
                  placeholder="Confirm your email"
                />
                {form.confirmEmail && form.email.toLowerCase() !== form.confirmEmail.toLowerCase() && (
                  <p className="text-xs text-red-400 mt-1">Emails do not match</p>
                )}
              </div>

              <div>
                <label className={labelClass}>Password</label>
                <input
                  type="password"
                  name="password"
                  required
                  value={form.password}
                  onChange={handleFormChange}
                  className={inputClass}
                  placeholder="Minimum 8 characters"
                />
              </div>

              <div>
                <label className={labelClass}>Confirm Password</label>
                <input
                  type="password"
                  name="confirmPassword"
                  required
                  value={form.confirmPassword}
                  onChange={handleFormChange}
                  className={`${inputClass} ${
                    form.confirmPassword && form.password !== form.confirmPassword
                      ? "ring-2 ring-red-500/50"
                      : ""
                  }`}
                  placeholder="Re-enter your password"
                />
                {form.confirmPassword && form.password !== form.confirmPassword && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                )}
              </div>

              {error && <ErrorBox message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {stepLabel}</>
                ) : (
                  <><span>Continue</span><ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </form>
          </div>

          <p className="mt-4 text-center text-sm text-white/40">
            Already have an account?{" "}
            <Link href="/signin" className="text-[#a78bfa] hover:text-[#c4b5fd] transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    );
  }

  // ── STEP 2 (org only): Organization details ────────────────────────────────

  if (accountType === "org" && orgStep === 2) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={gradientStyle}>
        <div className="w-full max-w-md">
          <BackBtn onClick={() => { setOrgStep(1); setError(""); }} />
          <ProgressBar labels={ORG_STEP_LABELS} activeIndex={1} />

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8">
            <h1 className="text-xl font-bold text-white mb-1">Your Organization</h1>
            <p className="text-white/45 text-sm mb-6">Tell us the name of your team or club.</p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!orgName.trim()) { setError("Organization name is required."); return; }
                setError("");
                setOrgStep(3);
              }}
              className="space-y-4"
            >
              <div>
                <label className={labelClass}>Organization Name</label>
                <input
                  type="text"
                  required
                  value={orgName}
                  onChange={(e) => { setOrgName(e.target.value); setError(""); }}
                  className={inputClass}
                  placeholder="e.g. Acme Athletics"
                  autoFocus
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button
                type="submit"
                className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <span>Continue</span><ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP 3 (org only): Plan selection ──────────────────────────────────────

  if (accountType === "org" && orgStep === 3) {
    const activePlan = PLANS.find((p) => p.id === selectedPlan)!;
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={gradientStyle}>
        <div className="w-full max-w-3xl">
          <BackBtn onClick={() => { setOrgStep(2); setError(""); }} />
          <ProgressBar labels={ORG_STEP_LABELS} activeIndex={2} />

          <div className="text-center mb-5">
            <h1 className="text-xl font-bold text-white">Choose Your Plan</h1>
            <p className="text-white/45 text-sm mt-1">14-day free trial on all plans. Cancel anytime.</p>
          </div>

          {/* Currency toggle */}
          <div className="flex justify-center mb-6">
            <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-sm">
              {(["CAD", "USD"] as const).map((cur) => (
                <button
                  key={cur}
                  onClick={() => setCurrency(cur)}
                  className={`px-4 py-1.5 font-medium transition-colors ${
                    currency === cur
                      ? "bg-[#6c5ce7] text-white"
                      : "bg-white/5 text-white/45 hover:text-white/70"
                  }`}
                >
                  {cur}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-5">
            {PLANS.map((plan) => {
              const { Icon } = plan;
              const isSelected = selectedPlan === plan.id;
              const price = PRICES[plan.id][currency];
              return (
                <button
                  key={plan.id}
                  onClick={() => setSelectedPlan(plan.id)}
                  className={`flex flex-col p-5 rounded-2xl border text-left transition-all ${
                    isSelected
                      ? "border-[#6c5ce7] bg-[#6c5ce7]/15 ring-1 ring-[#6c5ce7]"
                      : "border-white/10 bg-white/5 hover:border-white/25 hover:bg-white/8"
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${plan.iconBg}`}>
                      <Icon className={`w-5 h-5 ${plan.iconColor}`} />
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[#6c5ce7] flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                  </div>
                  <p className="text-white font-semibold text-sm">{plan.name}</p>
                  <div className="flex items-baseline gap-0.5 mt-0.5 mb-0.5">
                    <span className="text-[#a78bfa] font-bold text-xl">{price}</span>
                    <span className="text-white/40 text-xs">/mo {currency}</span>
                  </div>
                  <p className="text-white/35 text-[11px] mb-3">Up to {plan.athleteLimit} athletes</p>
                  <p className="text-white/40 text-xs mb-3 leading-relaxed">{plan.description}</p>
                  <ul className="space-y-1.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-white/60">
                        <Check className="w-3 h-3 text-[#6c5ce7] mt-0.5 shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>

          <div className="mb-4 px-4 py-3 rounded-xl text-sm text-center bg-[#6c5ce7]/10 border border-[#6c5ce7]/20 text-[#a78bfa]">
            {activePlan.trialNote}
          </div>

          <button
            onClick={() => { setOrgStep(4); setError(""); }}
            className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <span>{activePlan.ctaLabel}</span>
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="mt-3 text-center text-xs text-white/30">
            After verifying your email, you&apos;ll be redirected to Stripe to set up billing.
          </p>
        </div>
      </div>
    );
  }

  // ── STEP 4 (org) / STEP 2 (user): Email verification ──────────────────────

  const isVerifyStep =
    (accountType === "user" && userStep === 2) ||
    (accountType === "org" && orgStep === 4);

  if (isVerifyStep) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={gradientStyle}>
        <div className="w-full max-w-md">
          <BackBtn
            onClick={() => {
              setConfirmationCode("");
              setError("");
              if (accountType === "user") setUserStep(1);
              else setOrgStep(3);
            }}
          />
          <ProgressBar
            labels={accountType === "org" ? ORG_STEP_LABELS : USER_STEP_LABELS}
            activeIndex={accountType === "org" ? 3 : 1}
          />

          <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8">
            <h1 className="text-xl font-bold text-white mb-2">Verify Your Email</h1>
            <p className="text-white/45 text-sm mb-6">
              We sent a 6-digit code to{" "}
              <span className="text-white font-medium">{form.email}</span>. Enter it below to continue.
            </p>

            {stepLabel.includes("verification code") && (
              <div className="mb-4 px-4 py-3 bg-blue-500/10 border border-blue-500/20 text-blue-300 rounded-lg text-sm">
                {stepLabel}
              </div>
            )}

            <form onSubmit={handleConfirm} className="space-y-4">
              <div>
                <label className={labelClass}>Confirmation Code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  value={confirmationCode}
                  onChange={(e) => { setConfirmationCode(e.target.value); setError(""); }}
                  className={`${inputClass} tracking-widest text-center text-lg`}
                  placeholder="123456"
                  maxLength={6}
                  autoFocus
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> {stepLabel}</>
                ) : (
                  "Verify & Continue"
                )}
              </button>
            </form>

            <p className="mt-5 text-center text-sm text-white/40">
              Didn&apos;t receive the code?{" "}
              <button
                type="button"
                onClick={handleResendCode}
                disabled={resending}
                className="text-[#a78bfa] hover:text-[#c4b5fd] transition-colors disabled:opacity-50"
              >
                {resending ? "Sending..." : "Resend code"}
              </button>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
