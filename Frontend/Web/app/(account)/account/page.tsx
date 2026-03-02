"use client";

import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useLazyQuery } from "@apollo/client/react";
import { useAuth } from "@/contexts/AuthContext";
import {
  UPDATE_USER,
  GENERATE_UPLOAD_URL,
  LEAVE_ORGANIZATION,
  GET_GUARDIAN_ATHLETES,
  GET_USER_STATS,
  TRANSFER_OWNERSHIP,
  CREATE_INVITE,
  CREATE_ORGANIZATION,
  GET_ORGANIZATION_USERS,
  DELETE_MY_ACCOUNT,
  GET_USER_HEALTH,
  CREATE_EMERGENCY_CONTACT,
  UPDATE_EMERGENCY_CONTACT,
  DELETE_EMERGENCY_CONTACT,
  UPSERT_MEDICAL_INFO,
  GET_USER_BADGES,
} from "@/lib/graphql";
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

const PLAN_OPTIONS = [
  {
    id: "STARTER" as const,
    name: "Starter",
    athletes: 75,
    Icon: Zap,
    iconColor: "text-blue-400",
    iconBg: "bg-blue-500/20",
    pricing: { CAD: "$80", USD: "$59" },
  },
  {
    id: "GROWTH" as const,
    name: "Growth",
    athletes: 200,
    Icon: BarChart2,
    iconColor: "text-purple-400",
    iconBg: "bg-purple-500/20",
    pricing: { CAD: "$200", USD: "$149" },
  },
  {
    id: "PRO" as const,
    name: "Pro",
    athletes: 500,
    Icon: Trophy,
    iconColor: "text-yellow-400",
    iconBg: "bg-yellow-500/20",
    pricing: { CAD: "$450", USD: "$329" },
  },
] as const;

type PlanId = "STARTER" | "GROWTH" | "PRO";
import {
  User,
  Building2,
  Heart,
  LogOut,
  Camera,
  Loader2,
  Check,
  ChevronRight,
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Shield,
  TrendingUp,
  Clock,
  Flame,
  Users,
  Send,
  LayoutDashboard,
  Smartphone,
  X,
  Plus,
  AlertTriangle,
  Trash2,
  Activity,
  CalendarDays,
  Edit2,
  Star,
  FileText,
  Stethoscope,
  Trophy,
  Lock,
  Zap,
  BarChart2,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPhone, maskPhone, sanitizePhone } from "@/lib/utils";

// ─── GraphQL ─────────────────────────────────────────────────────────────────

const GET_EMAIL_REPORT_CONFIGS = gql`
  query GetEmailReportConfigsAccount {
    myEmailReportConfigs {
      id
      frequency
      enabled
      lastSentAt
      organization { id name }
    }
  }
`;

const CREATE_EMAIL_REPORT_CONFIG = gql`
  mutation CreateEmailReportConfigAccount($input: CreateEmailReportConfigInput!) {
    createEmailReportConfig(input: $input) {
      id frequency enabled organization { id name }
    }
  }
`;

const UPDATE_EMAIL_REPORT_CONFIG = gql`
  mutation UpdateEmailReportConfigAccount($id: ID!, $enabled: Boolean) {
    updateEmailReportConfig(id: $id, enabled: $enabled) {
      id frequency enabled
    }
  }
`;

const DELETE_EMAIL_REPORT_CONFIG = gql`
  mutation DeleteEmailReportConfigAccount($id: ID!) {
    deleteEmailReportConfig(id: $id)
  }
`;

const SEND_TEST_REPORT = gql`
  mutation SendTestReportAccount($configId: ID!) {
    sendTestReport(configId: $configId)
  }
`;

// ─── Constants ────────────────────────────────────────────────────────────────

type Section = "profile" | "organizations" | "guardian" | "health" | "achievements" | "app-download" | "settings";

type EmergencyContact = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  email?: string;
  isPrimary: boolean;
};

type MedicalInfo = {
  id: string;
  conditions?: string;
  allergies?: string;
  medications?: string;
  insuranceProvider?: string;
  insurancePolicyNumber?: string;
  insuranceGroupNumber?: string;
  notes?: string;
  updatedAt?: string;
};
type ReportFrequency = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "BIANNUALLY" | "ANNUALLY";

type OrgMembership = {
  id: string;
  role: string;
  organization: { id: string; name: string };
};

type OrgMember = {
  id: string;
  role: string;
  user: { id: string; email: string; firstName: string; lastName: string };
};

const FREQUENCY_OPTIONS: { value: ReportFrequency; label: string; description: string }[] = [
  { value: "WEEKLY",     label: "Weekly",      description: "Every week" },
  { value: "MONTHLY",    label: "Monthly",     description: "Once a month" },
  { value: "QUARTERLY",  label: "Quarterly",   description: "Every 3 months" },
  { value: "BIANNUALLY", label: "Bi-annually", description: "Twice a year" },
  { value: "ANNUALLY",   label: "Annually",    description: "Once a year" },
];

const ROLE_COLORS: Record<string, string> = {
  OWNER:    "bg-yellow-600/20 text-yellow-400",
  ADMIN:    "bg-[#a855f7]/15 text-[#a78bfa]",
  MANAGER:  "bg-blue-600/20 text-blue-400",
  COACH:    "bg-green-600/20 text-green-400",
  ATHLETE:  "bg-white/10 text-white/70",
  GUARDIAN: "bg-pink-600/20 text-pink-400",
};

const inputClass =
  "w-full px-3 py-2.5 bg-white/8 border border-white/10 rounded-lg text-white text-sm placeholder-white/25 focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]";
const labelClass = "block text-xs font-medium text-white/55 mb-1";

// ─── Athlete Stats Card ───────────────────────────────────────────────────────

function AthleteStatsCard({
  athlete,
  organizationId,
}: {
  athlete: any;
  organizationId: string;
}) {
  const { data, loading } = useQuery<any>(GET_USER_STATS, {
    variables: { userId: athlete.id, organizationId, timeRange: "MONTH" },
  });
  const stats = data?.userStats;
  const teams = athlete.memberships
    ?.filter((m: any) => m.role !== "COACH" && m.role !== "ADMIN")
    .map((m: any) => m.team.name)
    .join(", ");

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-white/5">
      <div className="p-4 border-b border-white/8 flex items-center gap-3">
        {athlete.image ? (
          <img src={athlete.image} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-white/15" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-[#6c5ce7] flex items-center justify-center text-white font-semibold ring-2 ring-white/15">
            {athlete.firstName[0]}{athlete.lastName[0]}
          </div>
        )}
        <div className="min-w-0">
          <p className="text-white font-semibold">{athlete.firstName} {athlete.lastName}</p>
          {teams && <p className="text-white/40 text-xs truncate mt-0.5">{teams}</p>}
        </div>
      </div>
      <div className="p-4">
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: TrendingUp, label: "Attendance", value: stats.attendancePercent != null ? `${Math.round(stats.attendancePercent)}%` : "—" },
              { icon: Clock,      label: "Hours (mo.)", value: stats.hoursLogged != null ? stats.hoursLogged.toFixed(1) : "—" },
              { icon: Flame,      label: "Streak",      value: stats.currentStreak != null ? stats.currentStreak : "—" },
              { icon: Users,      label: "Team rank",   value: stats.teamRank != null ? `${stats.teamRank}/${stats.teamSize}` : "—" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="bg-white/5 rounded-lg p-2.5">
                <div className="flex items-center gap-1 mb-1">
                  <Icon className="w-3 h-3 text-[#a78bfa]" />
                  <span className="text-white/40 text-xs">{label}</span>
                </div>
                <p className="text-white font-bold text-lg">{value}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-white/30 text-sm text-center py-3">No stats available</p>
        )}
      </div>
    </div>
  );
}

// ─── Email Report Toggles (per org) ──────────────────────────────────────────

function OrgReportToggles({
  organizationId,
  configs,
  refetchConfigs,
}: {
  organizationId: string;
  configs: any[];
  refetchConfigs: () => void;
}) {
  const [togglingFreq, setTogglingFreq] = useState<string | null>(null);
  const [testSentFreq, setTestSentFreq] = useState<string | null>(null);

  const [createConfig] = useMutation(CREATE_EMAIL_REPORT_CONFIG);
  const [updateConfig] = useMutation(UPDATE_EMAIL_REPORT_CONFIG);
  const [deleteConfig] = useMutation(DELETE_EMAIL_REPORT_CONFIG);
  const [sendTestReport] = useMutation(SEND_TEST_REPORT);

  const configsByFreq = new Map<string, any>(configs.map((c) => [c.frequency, c]));

  const handleToggle = async (frequency: ReportFrequency) => {
    if (togglingFreq) return;
    setTogglingFreq(frequency);
    try {
      const existing = configsByFreq.get(frequency);
      if (existing) {
        existing.enabled
          ? await deleteConfig({ variables: { id: existing.id } })
          : await updateConfig({ variables: { id: existing.id, enabled: true } });
      } else {
        await createConfig({ variables: { input: { organizationId, frequency } } });
      }
      refetchConfigs();
    } catch (err) {
      console.error("Failed to toggle report frequency:", err);
    } finally {
      setTogglingFreq(null);
    }
  };

  const handleSendTest = async (frequency: ReportFrequency) => {
    const config = configsByFreq.get(frequency);
    if (!config) return;
    try {
      await sendTestReport({ variables: { configId: config.id } });
      setTestSentFreq(frequency);
      setTimeout(() => setTestSentFreq(null), 3000);
    } catch (err) {
      console.error("Failed to send test report:", err);
    }
  };

  return (
    <div className="space-y-2">
      {FREQUENCY_OPTIONS.map((option) => {
        const config = configsByFreq.get(option.value);
        const active = config?.enabled === true;
        const isToggling = togglingFreq === option.value;
        const testSent = testSentFreq === option.value;

        return (
          <div key={option.value} className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg">
            <div
              className="flex items-center gap-3 flex-1 cursor-pointer"
              onClick={() => !isToggling && handleToggle(option.value)}
            >
              <div className={`relative w-9 h-[18px] rounded-full transition-colors shrink-0 ${isToggling ? "opacity-50" : ""} ${active ? "bg-[#6c5ce7]" : "bg-white/15"}`}>
                <div className={`absolute top-0.5 w-3.5 h-3.5 bg-white rounded-full shadow transition-transform ${active ? "translate-x-[18px]" : "translate-x-0.5"}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{option.label}</p>
                <div className="flex items-center gap-3">
                  <p className="text-xs text-white/40">{option.description}</p>
                  {config?.lastSentAt && (
                    <p className="text-xs text-white/25 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Last sent {new Date(config.lastSentAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            </div>
            {active && (
              <button
                onClick={() => handleSendTest(option.value)}
                className={`ml-3 p-1.5 rounded-lg transition-colors shrink-0 ${testSent ? "text-green-400 bg-green-600/15" : "text-white/30 hover:text-[#a78bfa] hover:bg-[#a855f7]/10"}`}
                title="Send test report now"
              >
                {testSent ? <Check className="w-4 h-4" /> : <Send className="w-4 h-4" />}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const router = useRouter();
  const { user, isLoading, isAuthenticated, refetch, logout, selectedOrganizationId, setSelectedOrganizationId } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Redirect unauthenticated users to sign-in (replaces RequireAuth since this
  // layout does not use it — the account page must be accessible to all roles)
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace("/signin");
    }
  }, [isLoading, isAuthenticated, router]);

  const [activeSection, setActiveSection] = useState<Section>("profile");

  // Profile form
  const [firstName, setFirstName]   = useState("");
  const [lastName, setLastName]     = useState("");
  const [phone, setPhone]           = useState("");
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [address, setAddress]       = useState("");
  const [city, setCity]             = useState("");
  const [country, setCountry]       = useState("");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [profileSuccess, setProfileSuccess] = useState("");
  const [profileError, setProfileError]     = useState("");

  // Health & Safety — emergency contacts
  const [showEcModal, setShowEcModal]       = useState(false);
  const [ecEditTarget, setEcEditTarget]     = useState<EmergencyContact | null>(null);
  const [ecName, setEcName]                 = useState("");
  const [ecRelationship, setEcRelationship] = useState("");
  const [ecPhone, setEcPhone]               = useState("");
  const [ecPhoneFocused, setEcPhoneFocused] = useState(false);
  const [ecEmail, setEcEmail]               = useState("");
  const [ecIsPrimary, setEcIsPrimary]       = useState(false);
  const [savingEc, setSavingEc]             = useState(false);
  const [ecError, setEcError]               = useState("");

  // Health & Safety — medical info
  const [medConditions, setMedConditions]               = useState("");
  const [medAllergies, setMedAllergies]                 = useState("");
  const [medMedications, setMedMedications]             = useState("");
  const [medInsuranceProvider, setMedInsuranceProvider] = useState("");
  const [medPolicyNumber, setMedPolicyNumber]           = useState("");
  const [medGroupNumber, setMedGroupNumber]             = useState("");
  const [medNotes, setMedNotes]                         = useState("");
  const [savingMed, setSavingMed]                       = useState(false);
  const [medSuccess, setMedSuccess]                     = useState("");

  // Create org modal
  const [showCreateOrg, setShowCreateOrg]   = useState(false);
  const [newOrgName, setNewOrgName]         = useState("");
  const [newOrgPlan, setNewOrgPlan]         = useState<PlanId>("STARTER");
  const [newOrgCurrency, setNewOrgCurrency] = useState<"CAD" | "USD">("USD");
  const [createOrgError, setCreateOrgError] = useState("");

  // Transfer ownership modal
  const [transferModalOrg, setTransferModalOrg] = useState<OrgMembership | null>(null);
  const [selectedNewOwner, setSelectedNewOwner] = useState<string | null>(null);
  const [transferError, setTransferError]       = useState("");

  // Invite guardian modal
  const [guardianModalOrg, setGuardianModalOrg] = useState<OrgMembership | null>(null);
  const [guardianEmail, setGuardianEmail]       = useState("");
  const [guardianSuccess, setGuardianSuccess]   = useState("");
  const [guardianError, setGuardianError]       = useState("");

  // Delete account modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting]               = useState(false);

  // Mutations
  const [updateUser, { loading: saving }]         = useMutation(UPDATE_USER);
  const [generateUploadUrl]                        = useMutation<{ generateUploadUrl: { uploadUrl: string; publicUrl: string } }>(GENERATE_UPLOAD_URL);
  const [leaveOrg, { loading: leaving }]           = useMutation(LEAVE_ORGANIZATION);
  const [createOrganization, { loading: creatingOrg }] = useMutation(CREATE_ORGANIZATION);
  const [createOrgSubscription] = useMutation<{ createOrgSubscription: { checkoutUrl: string } }>(CREATE_ORG_SUBSCRIPTION);
  const [transferOwnership, { loading: transferring }] = useMutation(TRANSFER_OWNERSHIP);
  const [createInvite, { loading: inviting }]      = useMutation(CREATE_INVITE);
  const [deleteMyAccount]                          = useMutation(DELETE_MY_ACCOUNT);
  const [createEmergencyContact]                   = useMutation(CREATE_EMERGENCY_CONTACT);
  const [updateEmergencyContact]                   = useMutation(UPDATE_EMERGENCY_CONTACT);
  const [deleteEmergencyContact]                   = useMutation(DELETE_EMERGENCY_CONTACT);
  const [upsertMedicalInfo]                        = useMutation(UPSERT_MEDICAL_INFO);

  const { data: healthData, refetch: refetchHealth } = useQuery(GET_USER_HEALTH, {
    variables: { userId: user?.id, organizationId: selectedOrganizationId },
    skip: !user?.id || !selectedOrganizationId,
  });

  const emergencyContacts: EmergencyContact[] = (healthData as any)?.user?.emergencyContacts || [];
  const medicalInfo: MedicalInfo | null       = (healthData as any)?.user?.medicalInfo || null;

  const { data: badgesData, loading: badgesLoading } = useQuery(GET_USER_BADGES, {
    variables: { userId: user?.id, organizationId: selectedOrganizationId },
    skip: !user?.id || !selectedOrganizationId,
  });
  const userBadges: { id: string; name: string; description: string; category: string; icon: string; earned: boolean; progress: number; threshold: number }[] =
    (badgesData as any)?.getUserBadges?.badges || [];
  const totalBadgesEarned: number = (badgesData as any)?.getUserBadges?.totalEarned ?? 0;

  // Lazy query for transfer modal members
  const [fetchOrgUsers, { data: orgUsersData, loading: orgUsersLoading }] = useLazyQuery<any>(GET_ORGANIZATION_USERS);

  // Guardian data
  const orgMemberships  = (user?.organizationMemberships || []) as OrgMembership[];
  const guardianOrgs    = orgMemberships.filter((m) => m.role === "GUARDIAN");
  const athleteOrgs     = orgMemberships.filter((m) => m.role === "ATHLETE");
  const isGuardian      = guardianOrgs.length > 0;
  const hasAthleteOrGuardian = orgMemberships.some((m) => m.role === "ATHLETE" || m.role === "GUARDIAN");

  const { data: configsData, refetch: refetchConfigs } = useQuery(GET_EMAIL_REPORT_CONFIGS, {
    skip: !isGuardian,
  });
  const allConfigs: any[] = (configsData as any)?.myEmailReportConfigs || [];

  useEffect(() => {
    if (user) {
      setFirstName(user.firstName || "");
      setLastName(user.lastName || "");
      setPhone(formatPhone(user.phone));
      setDateOfBirth(user.dateOfBirth ? user.dateOfBirth.slice(0, 10) : "");
      setAddress(user.address || "");
      setCity(user.city || "");
      setCountry(user.country || "");
      if (user.image) setImagePreview(user.image);
    }
  }, [user]);

  useEffect(() => {
    if (medicalInfo) {
      setMedConditions(medicalInfo.conditions || "");
      setMedAllergies(medicalInfo.allergies || "");
      setMedMedications(medicalInfo.medications || "");
      setMedInsuranceProvider(medicalInfo.insuranceProvider || "");
      setMedPolicyNumber(medicalInfo.insurancePolicyNumber || "");
      setMedGroupNumber(medicalInfo.insuranceGroupNumber || "");
      setMedNotes(medicalInfo.notes || "");
    }
  }, [medicalInfo]);

  // All hooks declared above — safe to return early now (Rules of Hooks satisfied)
  if (isLoading || !isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-500" />
      </div>
    );
  }

  const navItems: { id: Section; label: string; icon: React.ElementType; hidden?: boolean }[] = [
    { id: "profile",       label: "Profile",          icon: User },
    { id: "organizations", label: "Organizations",    icon: Building2 },
    { id: "guardian",      label: "Family",           icon: Heart },
    { id: "health",        label: "Health & Safety",  icon: Activity, hidden: !selectedOrganizationId },
    { id: "achievements",  label: "Achievements",     icon: Trophy, hidden: !selectedOrganizationId },
    { id: "app-download",  label: "App Download",     icon: Smartphone, hidden: !hasAthleteOrGuardian },
    { id: "settings",      label: "Settings",         icon: Trash2 },
  ];

  // ── Image upload ──────────────────────────────────────────────────────────
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setProfileError("Please select a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfileError("Image must be under 5MB.");
      return;
    }
    setUploading(true);
    setProfileError("");
    try {
      const { data } = await generateUploadUrl({ variables: { fileType: file.type } });
      const { uploadUrl, publicUrl } = data!.generateUploadUrl;
      const res = await fetch(uploadUrl, { method: "PUT", body: file, headers: { "Content-Type": file.type } });
      if (!res.ok) throw new Error("Upload failed");
      const imageUrl = `${publicUrl}?t=${Date.now()}`;
      await updateUser({ variables: { id: user!.id, input: { image: imageUrl } } });
      setImagePreview(imageUrl);
      await refetch();
      setProfileSuccess("Profile picture updated!");
      setTimeout(() => setProfileSuccess(""), 3000);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : "Failed to upload image");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ── Save profile ──────────────────────────────────────────────────────────
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSuccess("");
    setProfileError("");
    try {
      await updateUser({
        variables: {
          id: user!.id,
          input: {
            firstName,
            lastName,
            phone: sanitizePhone(phone) || undefined,
            dateOfBirth: dateOfBirth || undefined,
            address: address || undefined,
            city: city || undefined,
            country: country || undefined,
          },
        },
      });
      await refetch();
      setProfileSuccess("Profile updated successfully!");
      setTimeout(() => setProfileSuccess(""), 3000);
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : "Failed to update profile");
    }
  };

  // ── Leave org ─────────────────────────────────────────────────────────────
  const handleLeaveOrg = async (orgId: string, orgName: string) => {
    if (!confirm(`Leave "${orgName}"? You will lose access to all data in this organization.`)) return;
    try {
      await leaveOrg({ variables: { organizationId: orgId } });
      if (selectedOrganizationId === orgId) {
        const remaining = orgMemberships.filter((m) => m.organization.id !== orgId);
        setSelectedOrganizationId(remaining[0]?.organization.id ?? null);
      }
      await refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to leave organization");
    }
  };

  // ── Create org ────────────────────────────────────────────────────────────
  // Detect currency from browser locale on mount
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setNewOrgCurrency(navigator.language?.toLowerCase().endsWith("-ca") ? "CAD" : "USD");
    }
  }, []);

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateOrgError("");
    try {
      const orgResult = await createOrganization({ variables: { input: { name: newOrgName } } });
      const orgId = (orgResult.data as any)?.createOrganization?.id as string | undefined;

      if (orgId) {
        const subResult = await createOrgSubscription({
          variables: {
            organizationId: orgId,
            tier: newOrgPlan,
            currency: newOrgCurrency.toLowerCase(),
            billingPeriod: "MONTHLY",
          },
        });
        const checkoutUrl = subResult.data?.createOrgSubscription?.checkoutUrl;
        if (checkoutUrl) {
          window.location.href = checkoutUrl;
          return;
        }
      }

      // Fallback (Stripe not configured in dev)
      setShowCreateOrg(false);
      setNewOrgName("");
      await refetch();
    } catch (err: unknown) {
      setCreateOrgError(err instanceof Error ? err.message : "Failed to create organization");
    }
  };

  // ── Transfer ownership ────────────────────────────────────────────────────
  const openTransferModal = (org: OrgMembership) => {
    setTransferModalOrg(org);
    setSelectedNewOwner(null);
    setTransferError("");
    fetchOrgUsers({ variables: { id: org.organization.id } });
  };

  const handleTransfer = async () => {
    if (!transferModalOrg || !selectedNewOwner) return;
    setTransferError("");
    try {
      await transferOwnership({
        variables: { organizationId: transferModalOrg.organization.id, newOwnerId: selectedNewOwner },
      });
      setTransferModalOrg(null);
      await refetch();
    } catch (err: unknown) {
      setTransferError(err instanceof Error ? err.message : "Failed to transfer ownership");
    }
  };

  // ── Invite guardian ───────────────────────────────────────────────────────
  const handleInviteGuardian = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!guardianModalOrg) return;
    setGuardianSuccess("");
    setGuardianError("");
    try {
      await createInvite({
        variables: { input: { email: guardianEmail, organizationId: guardianModalOrg.organization.id, role: "GUARDIAN" } },
      });
      setGuardianSuccess("Guardian invite sent!");
      setGuardianEmail("");
      setTimeout(() => { setGuardianSuccess(""); setGuardianModalOrg(null); }, 2000);
    } catch (err: unknown) {
      setGuardianError(err instanceof Error ? err.message : "Failed to send invite");
    }
  };

  // ── Emergency contacts ────────────────────────────────────────────────────
  const openEcModal = (contact?: EmergencyContact) => {
    setEcEditTarget(contact || null);
    setEcName(contact?.name || "");
    setEcRelationship(contact?.relationship || "");
    setEcPhone(formatPhone(contact?.phone || ""));
    setEcEmail(contact?.email || "");
    setEcIsPrimary(contact?.isPrimary || false);
    setEcError("");
    setShowEcModal(true);
  };

  const handleSaveEc = async () => {
    if (!ecName.trim() || !ecRelationship.trim() || !sanitizePhone(ecPhone)) {
      setEcError("Name, relationship, and phone are required.");
      return;
    }
    setSavingEc(true);
    setEcError("");
    try {
      const input = {
        name: ecName.trim(),
        relationship: ecRelationship.trim(),
        phone: sanitizePhone(ecPhone),
        email: ecEmail.trim() || undefined,
        isPrimary: ecIsPrimary,
      };
      if (ecEditTarget) {
        await updateEmergencyContact({ variables: { id: ecEditTarget.id, input } });
      } else {
        await createEmergencyContact({
          variables: { input: { ...input, userId: user!.id, organizationId: selectedOrganizationId! } },
        });
      }
      setShowEcModal(false);
      refetchHealth();
    } catch (err: unknown) {
      setEcError(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSavingEc(false);
    }
  };

  const handleDeleteEc = async (id: string) => {
    if (!confirm("Remove this emergency contact?")) return;
    try {
      await deleteEmergencyContact({ variables: { id } });
      refetchHealth();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to delete contact");
    }
  };

  // ── Medical info ──────────────────────────────────────────────────────────
  const handleSaveMedical = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMed(true);
    setMedSuccess("");
    try {
      await upsertMedicalInfo({
        variables: {
          input: {
            userId: user!.id,
            organizationId: selectedOrganizationId!,
            conditions: medConditions || undefined,
            allergies: medAllergies || undefined,
            medications: medMedications || undefined,
            insuranceProvider: medInsuranceProvider || undefined,
            insurancePolicyNumber: medPolicyNumber || undefined,
            insuranceGroupNumber: medGroupNumber || undefined,
            notes: medNotes || undefined,
          },
        },
      });
      refetchHealth();
      setMedSuccess("Medical information saved!");
      setTimeout(() => setMedSuccess(""), 3000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to save medical information");
    } finally {
      setSavingMed(false);
    }
  };

  // ── Delete account ────────────────────────────────────────────────────────
  const handleDeleteAccount = async () => {
    setDeleting(true);
    try {
      await deleteMyAccount();
      await logout();
    } catch (err) {
      console.error("Failed to delete account:", err);
      setDeleting(false);
    }
  };

  const orgMembers: OrgMember[] = (orgUsersData as any)?.organization?.members || [];
  const transferCandidates = orgMembers.filter((m) => m.user.id !== user?.id);

  return (
    <div
      className="min-h-screen"
      style={{ background: "linear-gradient(160deg, #302b6f 10%, #4d2a69 60%, #302b6f 100%)" }}
    >
      {/* ── Top Navbar ─────────────────────────────────────────────────────── */}
      <header className="h-16 flex items-center justify-between px-6 border-b border-white/8 bg-[rgba(20,15,50,0.35)]">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-white/55 hover:text-white transition-colors text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <div className="w-px h-4 bg-white/15" />
          <Image
            src="/logo/white_icon_transparent_background.png"
            alt="Athletiq"
            width={90}
            height={24}
            className="object-contain max-h-8"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-white leading-tight">
              {user?.firstName} {user?.lastName}
            </p>
            <p className="text-xs text-white/40">{user?.email}</p>
          </div>
          {imagePreview ? (
            <img src={imagePreview} alt="" className="w-9 h-9 rounded-full object-cover ring-2 ring-[#6c5ce7]/50" />
          ) : (
            <div className="w-9 h-9 rounded-full bg-[#6c5ce7] flex items-center justify-center text-white text-sm font-medium">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
          )}
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex min-h-[calc(100vh-4rem)]">
        {/* Left sub-nav */}
        <aside className="w-52 shrink-0 border-r border-white/8 bg-[rgba(20,15,50,0.2)] flex flex-col">
          <nav className="flex-1 px-3 py-6 space-y-1">
            {navItems.filter((item) => !item.hidden).map((item) => {
              const active = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveSection(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                    active ? "bg-[#6c5ce7] text-white" : "text-white/65 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <item.icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </nav>
          <div className="px-3 py-4 border-t border-white/8">
            <button
              onClick={() => logout()}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-white/55 hover:bg-red-600/10 hover:text-red-400 transition-colors"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-8 py-8">

            {/* ── Profile ──────────────────────────────────────────────────── */}
            {activeSection === "profile" && (
              <div>
                <h1 className="text-xl font-bold text-white mb-6">Profile</h1>

                {/* Avatar card */}
                <div className="flex items-center gap-5 mb-8 p-5 bg-white/5 rounded-xl border border-white/8">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="relative w-20 h-20 rounded-full overflow-hidden group shrink-0"
                  >
                    {imagePreview ? (
                      <img src={imagePreview} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-[#6c5ce7] flex items-center justify-center text-white text-2xl font-semibold">
                        {user?.firstName?.[0]}{user?.lastName?.[0]}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                      {uploading ? <Loader2 className="w-5 h-5 text-white animate-spin" /> : <Camera className="w-5 h-5 text-white" />}
                    </div>
                  </button>
                  <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleImageSelect} className="hidden" />
                  <div>
                    <p className="text-base font-semibold text-white">{user?.firstName} {user?.lastName}</p>
                    <p className="text-sm text-white/40 mt-0.5">{user?.email}</p>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="mt-2 text-xs text-[#a78bfa] hover:text-[#c4b5fd] transition-colors disabled:opacity-50"
                    >
                      {uploading ? "Uploading…" : "Change photo"}
                    </button>
                  </div>
                </div>

                {profileSuccess && (
                  <div className="mb-4 px-4 py-3 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm flex items-center gap-2">
                    <Check className="w-4 h-4" /> {profileSuccess}
                  </div>
                )}
                {profileError && (
                  <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg text-sm">
                    {profileError}
                  </div>
                )}

                <form onSubmit={handleSaveProfile} className="space-y-5">
                  <div>
                    <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Personal Info</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass}>First Name</label>
                        <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inputClass} required />
                      </div>
                      <div>
                        <label className={labelClass}>Last Name</label>
                        <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} required />
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className={labelClass}>
                      <span className="flex items-center gap-1.5"><CalendarDays className="w-3 h-3" /> Date of Birth</span>
                    </label>
                    <input
                      type="date"
                      value={dateOfBirth}
                      onChange={(e) => setDateOfBirth(e.target.value)}
                      className={`${inputClass} [color-scheme:dark]`}
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Contact</p>
                    <div className="space-y-3">
                      <div>
                        <label className={labelClass}>
                          <span className="flex items-center gap-1.5">
                            <Mail className="w-3 h-3" /> Email
                            <span className="ml-1 text-white/25 normal-case font-normal">(managed by your account provider)</span>
                          </span>
                        </label>
                        <input type="email" value={user?.email || ""} disabled className={`${inputClass} opacity-40 cursor-not-allowed`} />
                      </div>
                      <div>
                        <label className={labelClass}>
                          <span className="flex items-center gap-1.5"><Phone className="w-3 h-3" /> Phone</span>
                        </label>
                        <input
                          type="tel"
                          value={phoneFocused && !sanitizePhone(phone) ? "(" : phone}
                          onFocus={() => setPhoneFocused(true)}
                          onBlur={() => { setPhoneFocused(false); if (!sanitizePhone(phone)) setPhone(""); }}
                          onChange={(e) => setPhone(maskPhone(e.target.value))}
                          placeholder="(555) 123-4567"
                          className={inputClass}
                        />
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Location</p>
                    <div className="space-y-3">
                      <div>
                        <label className={labelClass}>
                          <span className="flex items-center gap-1.5"><MapPin className="w-3 h-3" /> Address</span>
                        </label>
                        <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Main St" className={inputClass} />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>City</label>
                          <input type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="New York" className={inputClass} />
                        </div>
                        <div>
                          <label className={labelClass}>Country</label>
                          <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="United States" className={inputClass} />
                        </div>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="flex items-center gap-2 px-5 py-2.5 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                  >
                    {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save Changes</>}
                  </button>
                </form>
              </div>
            )}

            {/* ── Organizations ────────────────────────────────────────────── */}
            {activeSection === "organizations" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-xl font-bold text-white">Organizations</h1>
                  <button
                    onClick={() => { setShowCreateOrg(true); setNewOrgName(""); setCreateOrgError(""); }}
                    className="flex items-center gap-1.5 px-3 py-2 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                    Create Organization
                  </button>
                </div>

                {orgMemberships.length === 0 ? (
                  <div className="text-center py-12 bg-white/5 rounded-xl border border-white/8">
                    <Building2 className="w-10 h-10 text-white/20 mx-auto mb-3" />
                    <p className="text-white/40 text-sm mb-4">You are not a member of any organization.</p>
                    <button
                      onClick={() => { setShowCreateOrg(true); setNewOrgName(""); setCreateOrgError(""); }}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Create Your First Organization
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orgMemberships.map((m) => {
                      const isActive   = m.organization.id === selectedOrganizationId;
                      const isOwner    = m.role === "OWNER";
                      const canDash    = ["OWNER","ADMIN","MANAGER","COACH"].includes(m.role);
                      return (
                        <div
                          key={m.id}
                          className={`p-4 rounded-xl border transition-colors ${isActive ? "bg-[#6c5ce7]/10 border-[#6c5ce7]/40" : "bg-white/5 border-white/8"}`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-10 rounded-lg bg-[#6c5ce7]/20 flex items-center justify-center shrink-0">
                                <Building2 className="w-5 h-5 text-[#a78bfa]" />
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-white truncate">{m.organization.name}</p>
                                  {isActive && (
                                    <span className="px-1.5 py-0.5 text-xs bg-[#6c5ce7]/30 text-[#c4b5fd] rounded font-medium">Active</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <Shield className="w-3 h-3 text-white/25" />
                                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${ROLE_COLORS[m.role] || "bg-white/10 text-white/55"}`}>
                                    {m.role}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-3 flex-wrap justify-end">
                              {canDash && (
                                <button
                                  onClick={() => {
                                    setSelectedOrganizationId(m.organization.id);
                                    router.push("/dashboard");
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/65 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                >
                                  <LayoutDashboard className="w-3.5 h-3.5" />
                                  {isActive ? "Dashboard" : "Switch & Go"}
                                </button>
                              )}
                              {!isActive && !canDash && (
                                <button
                                  onClick={() => setSelectedOrganizationId(m.organization.id)}
                                  className="flex items-center gap-1 px-3 py-1.5 text-xs bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white rounded-lg transition-colors"
                                >
                                  Switch <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                              {isOwner && (
                                <button
                                  onClick={() => openTransferModal(m)}
                                  className="px-3 py-1.5 text-xs text-yellow-400/80 hover:text-yellow-400 hover:bg-yellow-600/10 rounded-lg transition-colors"
                                >
                                  Transfer
                                </button>
                              )}
                              {m.role === "ATHLETE" && (
                                <button
                                  onClick={() => { setGuardianModalOrg(m); setGuardianEmail(""); setGuardianSuccess(""); setGuardianError(""); }}
                                  className="px-3 py-1.5 text-xs text-pink-400/80 hover:text-pink-400 hover:bg-pink-600/10 rounded-lg transition-colors"
                                >
                                  Invite Guardian
                                </button>
                              )}
                              {!isOwner && (
                                <button
                                  onClick={() => handleLeaveOrg(m.organization.id, m.organization.name)}
                                  disabled={leaving}
                                  className="px-3 py-1.5 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-600/10 rounded-lg transition-colors"
                                >
                                  Leave
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Family / Guardian ─────────────────────────────────────────── */}
            {activeSection === "guardian" && (
              <div className="space-y-8">
                <h1 className="text-xl font-bold text-white">Family</h1>

                {/* Invite guardian — shown for each org where user is an athlete */}
                {athleteOrgs.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Invite a Guardian</p>
                    <div className="space-y-3">
                      {athleteOrgs.map((m) => (
                        <div key={m.id} className="flex items-center justify-between p-4 bg-white/5 rounded-xl border border-white/8">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-pink-600/20 flex items-center justify-center shrink-0">
                              <Heart className="w-4 h-4 text-pink-400" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white truncate">{m.organization.name}</p>
                              <p className="text-xs text-white/40">Invite a parent or guardian to view your activity</p>
                            </div>
                          </div>
                          <button
                            onClick={() => { setGuardianModalOrg(m); setGuardianEmail(""); setGuardianSuccess(""); setGuardianError(""); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-pink-600/20 hover:bg-pink-600/30 text-pink-400 border border-pink-500/30 rounded-lg transition-colors shrink-0 ml-3"
                          >
                            <Plus className="w-3.5 h-3.5" /> Invite Guardian
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* My guardians (linked athletes view) */}
                {guardianOrgs.length === 0 && athleteOrgs.length === 0 && (
                  <div className="p-6 bg-white/5 rounded-xl border border-white/8 text-center">
                    <Heart className="w-8 h-8 text-white/20 mx-auto mb-3" />
                    <p className="text-sm font-medium text-white/55">No family connections yet</p>
                    <p className="text-xs text-white/30 mt-1">
                      Join an organization as an athlete to invite a guardian, or ask an admin to send you a guardian invite.
                    </p>
                  </div>
                )}

                {guardianOrgs.map((m) => {
                  const orgConfigs = allConfigs.filter((c: any) => c.organization.id === m.organization.id);
                  return (
                    <OrgGuardianSection
                      key={m.id}
                      orgId={m.organization.id}
                      orgName={m.organization.name}
                      orgConfigs={orgConfigs}
                      refetchConfigs={refetchConfigs}
                    />
                  );
                })}
              </div>
            )}

            {/* ── Health & Safety ───────────────────────────────────────────── */}
            {activeSection === "health" && (
              <div className="space-y-8">
                <h1 className="text-xl font-bold text-white">Health & Safety</h1>

                {!selectedOrganizationId ? (
                  <div className="p-6 bg-white/5 rounded-xl border border-white/8 text-center">
                    <Activity className="w-8 h-8 text-white/20 mx-auto mb-3" />
                    <p className="text-sm text-white/50">Join an organization to manage health & safety information.</p>
                  </div>
                ) : (
                  <>
                    {/* Emergency Contacts */}
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Emergency Contacts</p>
                          <p className="text-xs text-white/30 mt-0.5">Visible to coaches and admins in an emergency.</p>
                        </div>
                        <button
                          onClick={() => openEcModal()}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add Contact
                        </button>
                      </div>

                      {emergencyContacts.length === 0 ? (
                        <div className="p-5 bg-white/5 rounded-xl border border-white/8 text-center">
                          <Phone className="w-7 h-7 text-white/20 mx-auto mb-2" />
                          <p className="text-sm text-white/40">No emergency contacts added yet.</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {emergencyContacts.map((ec) => (
                            <div key={ec.id} className="flex items-start justify-between p-4 bg-white/5 rounded-xl border border-white/8">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-sm font-semibold text-white">{ec.name}</p>
                                  {ec.isPrimary && (
                                    <span className="flex items-center gap-1 px-1.5 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs font-medium rounded">
                                      <Star className="w-3 h-3" /> Primary
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-white/40 mt-0.5">{ec.relationship}</p>
                                <p className="text-xs text-white/60 mt-1">{formatPhone(ec.phone)}</p>
                                {ec.email && <p className="text-xs text-white/40">{ec.email}</p>}
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-3">
                                <button
                                  onClick={() => openEcModal(ec)}
                                  className="p-1.5 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                >
                                  <Edit2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleDeleteEc(ec.id)}
                                  className="p-1.5 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Medical Information */}
                    <div>
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Medical Information</p>
                        <p className="text-xs text-white/30 mt-0.5">Only visible to authorized staff in your organization.</p>
                      </div>

                      {medSuccess && (
                        <div className="mb-4 px-4 py-3 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm flex items-center gap-2">
                          <Check className="w-4 h-4" /> {medSuccess}
                        </div>
                      )}

                      <form onSubmit={handleSaveMedical} className="space-y-4">
                        <div className="bg-white/5 rounded-xl border border-white/8 p-5 space-y-4">
                          <div className="flex items-center gap-2 mb-1">
                            <Stethoscope className="w-4 h-4 text-[#a78bfa]" />
                            <p className="text-sm font-semibold text-white">Health Conditions</p>
                          </div>
                          <div>
                            <label className={labelClass}>Allergies</label>
                            <textarea rows={2} value={medAllergies} onChange={(e) => setMedAllergies(e.target.value)} placeholder="e.g. Peanuts, penicillin…" className={`${inputClass} resize-none`} />
                          </div>
                          <div>
                            <label className={labelClass}>Medical Conditions</label>
                            <textarea rows={2} value={medConditions} onChange={(e) => setMedConditions(e.target.value)} placeholder="e.g. Asthma, diabetes…" className={`${inputClass} resize-none`} />
                          </div>
                          <div>
                            <label className={labelClass}>Current Medications</label>
                            <textarea rows={2} value={medMedications} onChange={(e) => setMedMedications(e.target.value)} placeholder="e.g. Albuterol, metformin…" className={`${inputClass} resize-none`} />
                          </div>
                          <div>
                            <label className={labelClass}>Additional Notes</label>
                            <textarea rows={2} value={medNotes} onChange={(e) => setMedNotes(e.target.value)} placeholder="Any other relevant health information…" className={`${inputClass} resize-none`} />
                          </div>
                        </div>

                        <div className="bg-white/5 rounded-xl border border-white/8 p-5 space-y-4">
                          <div className="flex items-center gap-2 mb-1">
                            <FileText className="w-4 h-4 text-[#a78bfa]" />
                            <p className="text-sm font-semibold text-white">Insurance</p>
                          </div>
                          <div>
                            <label className={labelClass}>Insurance Provider</label>
                            <input type="text" value={medInsuranceProvider} onChange={(e) => setMedInsuranceProvider(e.target.value)} placeholder="e.g. Blue Cross Blue Shield" className={inputClass} />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className={labelClass}>Policy Number</label>
                              <input type="text" value={medPolicyNumber} onChange={(e) => setMedPolicyNumber(e.target.value)} placeholder="Policy #" className={inputClass} />
                            </div>
                            <div>
                              <label className={labelClass}>Group Number</label>
                              <input type="text" value={medGroupNumber} onChange={(e) => setMedGroupNumber(e.target.value)} placeholder="Group #" className={inputClass} />
                            </div>
                          </div>
                        </div>

                        <button
                          type="submit"
                          disabled={savingMed || !selectedOrganizationId}
                          className="flex items-center gap-2 px-5 py-2.5 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                        >
                          {savingMed ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save Medical Info</>}
                        </button>
                      </form>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Achievements ──────────────────────────────────────────────── */}
            {activeSection === "achievements" && (
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-xl font-bold text-white">Achievements</h1>
                  {!badgesLoading && (
                    <span className="px-3 py-1 bg-[#a855f7]/15 text-[#a78bfa] text-xs font-semibold rounded-full">
                      {totalBadgesEarned} / {userBadges.length} earned
                    </span>
                  )}
                </div>

                {badgesLoading ? (
                  <div className="flex justify-center py-16">
                    <div className="w-7 h-7 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
                  </div>
                ) : userBadges.length === 0 ? (
                  <div className="bg-white/5 rounded-xl border border-white/8 p-8 text-center">
                    <Trophy className="w-12 h-12 text-white/20 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">No badge data available. Start attending events to earn achievements!</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {["hours", "streak", "attendance", "checkins"].map((category) => {
                      const categoryBadges = userBadges.filter((b) => b.category === category);
                      if (!categoryBadges.length) return null;
                      const categoryLabels: Record<string, string> = {
                        hours: "Training Hours",
                        streak: "Attendance Streaks",
                        attendance: "Attendance Rate",
                        checkins: "Check-ins",
                      };
                      return (
                        <div key={category}>
                          <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">
                            {categoryLabels[category]}
                          </h2>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {categoryBadges.map((badge) => (
                              <div
                                key={badge.id}
                                className={`flex items-start gap-4 p-4 rounded-xl border transition-colors ${
                                  badge.earned
                                    ? "bg-[#a855f7]/10 border-[#a855f7]/30"
                                    : "bg-white/3 border-white/8 opacity-60"
                                }`}
                              >
                                <div
                                  className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0 ${
                                    badge.earned ? "bg-[#a855f7]/20" : "bg-white/8"
                                  }`}
                                >
                                  {badge.earned ? badge.icon : <Lock className="w-5 h-5 text-white/30" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 mb-0.5">
                                    <p className={`text-sm font-semibold ${badge.earned ? "text-white" : "text-white/50"}`}>
                                      {badge.name}
                                    </p>
                                    {badge.earned && (
                                      <span className="w-4 h-4 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                                        <Check className="w-2.5 h-2.5 text-white" />
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-xs text-white/40 mb-2">{badge.description}</p>
                                  {!badge.earned && (
                                    <div>
                                      <div className="flex justify-between text-xs text-white/30 mb-1">
                                        <span>{Math.round(badge.progress)}</span>
                                        <span>{badge.threshold}</span>
                                      </div>
                                      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                        <div
                                          className="h-full bg-[#6c5ce7] rounded-full transition-all"
                                          style={{ width: `${Math.min(100, (badge.progress / badge.threshold) * 100)}%` }}
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── App Download ──────────────────────────────────────────────── */}
            {activeSection === "app-download" && (
              <div>
                <h1 className="text-xl font-bold text-white mb-6">App Download</h1>
                <div className="bg-white/5 rounded-xl border border-white/8 p-8 text-center">
                  <Smartphone className="w-14 h-14 text-[#a78bfa] mx-auto mb-4" />
                  <h2 className="text-base font-semibold text-white mb-2">Get the Athletiq App</h2>
                  <p className="text-white/40 text-sm mb-6 max-w-xs mx-auto">
                    Download Athletiq on your phone to check in to events, track hours, and stay connected with your team.
                  </p>
                  <div className="flex flex-col gap-3 max-w-xs mx-auto">
                    <button
                      disabled
                      className="w-full py-3 px-4 bg-white/8 text-white/35 font-medium rounded-lg cursor-not-allowed text-sm border border-white/10"
                    >
                      App Store — Coming Soon
                    </button>
                    <button
                      disabled
                      className="w-full py-3 px-4 bg-white/8 text-white/35 font-medium rounded-lg cursor-not-allowed text-sm border border-white/10"
                    >
                      Google Play — Coming Soon
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Settings ─────────────────────────────────────────────────── */}
            {activeSection === "settings" && (
              <div>
                <h1 className="text-xl font-bold text-white mb-6">Settings</h1>

                <div className="bg-white/5 rounded-xl border border-red-500/20 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Trash2 className="w-4 h-4 text-red-400" />
                    <h2 className="text-sm font-semibold text-white">Danger Zone</h2>
                  </div>
                  <p className="text-sm text-white/50 mb-4">
                    Permanently delete your account and all associated data. This action cannot be undone.
                  </p>
                  <button
                    onClick={() => setShowDeleteModal(true)}
                    className="flex items-center gap-2 px-4 py-2.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm font-medium rounded-lg transition-colors border border-red-600/30"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    Delete Account
                  </button>
                </div>
              </div>
            )}

          </div>
        </main>
      </div>

      {/* ── Emergency Contact Modal ─────────────────────────────────────────── */}
      {showEcModal && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e1845] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">{ecEditTarget ? "Edit Contact" : "Add Emergency Contact"}</h2>
              <button onClick={() => setShowEcModal(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className={labelClass}>Full Name *</label>
                <input type="text" value={ecName} onChange={(e) => setEcName(e.target.value)} autoFocus className={inputClass} placeholder="Jane Doe" />
              </div>
              <div>
                <label className={labelClass}>Relationship *</label>
                <input type="text" value={ecRelationship} onChange={(e) => setEcRelationship(e.target.value)} className={inputClass} placeholder="e.g. Mother, Father, Coach" />
              </div>
              <div>
                <label className={labelClass}>Phone *</label>
                <input
                  type="tel"
                  value={ecPhoneFocused && !sanitizePhone(ecPhone) ? "(" : ecPhone}
                  onFocus={() => setEcPhoneFocused(true)}
                  onBlur={() => { setEcPhoneFocused(false); if (!sanitizePhone(ecPhone)) setEcPhone(""); }}
                  onChange={(e) => setEcPhone(maskPhone(e.target.value))}
                  placeholder="(555) 123-4567"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input type="email" value={ecEmail} onChange={(e) => setEcEmail(e.target.value)} className={inputClass} placeholder="Optional" />
              </div>
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ecIsPrimary}
                  onChange={(e) => setEcIsPrimary(e.target.checked)}
                  className="w-4 h-4 rounded accent-[#6c5ce7]"
                />
                <span className="text-sm text-white/70">Primary contact</span>
              </label>
            </div>
            {ecError && (
              <div className="mt-3 px-3 py-2 bg-red-600/20 border border-red-600/30 rounded-lg text-red-400 text-sm">{ecError}</div>
            )}
            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => setShowEcModal(false)} className="px-4 py-2 bg-white/8 hover:bg-white/12 text-white/65 text-sm font-medium rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={handleSaveEc}
                disabled={savingEc}
                className="flex items-center gap-2 px-4 py-2 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {savingEc ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Save Contact"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Create Organization Modal ───────────────────────────────────────── */}
      {showCreateOrg && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e1845] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Create Organization</h2>
              <button onClick={() => setShowCreateOrg(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-white/50 text-sm mb-4">You will be the owner. A 14-day free trial is included on all plans.</p>
            <form onSubmit={handleCreateOrg} className="space-y-4">
              <div>
                <label className={labelClass}>Organization Name</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newOrgName}
                  onChange={(e) => { setNewOrgName(e.target.value); setCreateOrgError(""); }}
                  className={inputClass}
                  placeholder="e.g. Westside Track Club"
                />
              </div>

              {/* Currency toggle */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-white/45">Currency</span>
                <div className="inline-flex rounded-lg border border-white/10 overflow-hidden text-xs">
                  {(["CAD", "USD"] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => setNewOrgCurrency(cur)}
                      className={`px-3 py-1.5 font-medium transition-colors ${
                        newOrgCurrency === cur
                          ? "bg-[#6c5ce7] text-white"
                          : "bg-white/5 text-white/45 hover:text-white/70"
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>

              {/* Plan selection */}
              <div className="grid grid-cols-3 gap-2">
                {PLAN_OPTIONS.map(({ id, name, athletes, Icon, iconColor, iconBg, pricing }) => {
                  const selected = newOrgPlan === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setNewOrgPlan(id)}
                      className={`flex flex-col items-start p-3 rounded-xl border text-left transition-all ${
                        selected
                          ? "border-[#6c5ce7] bg-[#6c5ce7]/15 ring-1 ring-[#6c5ce7]"
                          : "border-white/10 bg-white/5 hover:border-white/20"
                      }`}
                    >
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 ${iconBg}`}>
                        <Icon className={`w-4 h-4 ${iconColor}`} />
                      </div>
                      <p className="text-white text-xs font-semibold">{name}</p>
                      <p className="text-[#a78bfa] text-xs font-bold">{pricing[newOrgCurrency]}<span className="text-white/30 font-normal">/mo</span></p>
                      <p className="text-white/35 text-[10px] mt-0.5">{athletes} athletes</p>
                    </button>
                  );
                })}
              </div>

              {createOrgError && (
                <div className="px-3 py-2 bg-red-600/20 border border-red-600/30 rounded-lg text-red-400 text-sm">{createOrgError}</div>
              )}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setShowCreateOrg(false)} className="px-4 py-2 bg-white/8 hover:bg-white/12 text-white/65 text-sm font-medium rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={creatingOrg} className="flex items-center gap-2 px-4 py-2 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                  {creatingOrg ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</> : "Create & Set Up Billing"}
                </button>
              </div>
              <p className="text-center text-xs text-white/25">You'll be redirected to Stripe to set up billing after creation.</p>
            </form>
          </div>
        </div>
      )}

      {/* ── Transfer Ownership Modal ────────────────────────────────────────── */}
      {transferModalOrg && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e1845] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Transfer Ownership</h2>
              <button onClick={() => setTransferModalOrg(null)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-white/50 text-sm mb-1">
              Select a member to become the new owner of{" "}
              <span className="text-white font-medium">{transferModalOrg.organization.name}</span>.
            </p>
            <p className="text-yellow-400/80 text-xs mb-4">You will be demoted to Manager.</p>

            {orgUsersLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 text-[#a78bfa] animate-spin" />
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                {transferCandidates.map((m) => (
                  <button
                    key={m.user.id}
                    onClick={() => setSelectedNewOwner(m.user.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border text-left transition-colors ${
                      selectedNewOwner === m.user.id
                        ? "border-[#6c5ce7] bg-[#6c5ce7]/15"
                        : "border-white/10 bg-white/5 hover:bg-white/8"
                    }`}
                  >
                    <div>
                      <p className="text-sm text-white font-medium">{m.user.firstName} {m.user.lastName}</p>
                      <p className="text-xs text-white/40">{m.user.email}</p>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[m.role] || "bg-white/10 text-white/55"}`}>
                      {m.role}
                    </span>
                  </button>
                ))}
                {transferCandidates.length === 0 && (
                  <p className="text-white/30 text-sm text-center py-4">No other members in this organization.</p>
                )}
              </div>
            )}

            {transferError && (
              <div className="mb-4 px-3 py-2 bg-red-600/20 border border-red-600/30 rounded-lg text-red-400 text-sm">{transferError}</div>
            )}

            <div className="flex gap-3 justify-end">
              <button onClick={() => setTransferModalOrg(null)} className="px-4 py-2 bg-white/8 hover:bg-white/12 text-white/65 text-sm font-medium rounded-lg transition-colors">
                Cancel
              </button>
              <button
                onClick={handleTransfer}
                disabled={!selectedNewOwner || transferring}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {transferring ? <><Loader2 className="w-4 h-4 animate-spin" /> Transferring…</> : "Confirm Transfer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Invite Guardian Modal ───────────────────────────────────────────── */}
      {guardianModalOrg && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e1845] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-white">Invite Guardian</h2>
              <button onClick={() => setGuardianModalOrg(null)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-white/50 text-sm mb-4">
              Invite a parent or guardian to{" "}
              <span className="text-white font-medium">{guardianModalOrg.organization.name}</span>.
            </p>
            <form onSubmit={handleInviteGuardian} className="space-y-4">
              <div>
                <label className={labelClass}>Guardian&apos;s Email</label>
                <input
                  type="email"
                  required
                  autoFocus
                  value={guardianEmail}
                  onChange={(e) => { setGuardianEmail(e.target.value); setGuardianError(""); }}
                  className={inputClass}
                  placeholder="parent@example.com"
                />
              </div>
              {guardianSuccess && (
                <div className="px-3 py-2 bg-green-500/10 border border-green-500/30 text-green-400 rounded-lg text-sm flex items-center gap-2">
                  <Check className="w-4 h-4" /> {guardianSuccess}
                </div>
              )}
              {guardianError && (
                <div className="px-3 py-2 bg-red-600/20 border border-red-600/30 rounded-lg text-red-400 text-sm">{guardianError}</div>
              )}
              <div className="flex gap-3 justify-end">
                <button type="button" onClick={() => setGuardianModalOrg(null)} className="px-4 py-2 bg-white/8 hover:bg-white/12 text-white/65 text-sm font-medium rounded-lg transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={inviting} className="flex items-center gap-2 px-4 py-2 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                  {inviting ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending…</> : "Send Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete Account Modal ────────────────────────────────────────────── */}
      {showDeleteModal && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e1845] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white">Delete Account</h3>
              <button onClick={() => setShowDeleteModal(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-start gap-3 mb-5">
              <AlertTriangle className="w-5 h-5 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-white/60">
                Are you sure you want to delete your account? This will permanently remove all your data and cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 bg-white/8 hover:bg-white/12 text-white/65 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</> : "Delete My Account"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Per-org guardian section ─────────────────────────────────────────────────

function OrgGuardianSection({
  orgId,
  orgName,
  orgConfigs,
  refetchConfigs,
}: {
  orgId: string;
  orgName: string;
  orgConfigs: any[];
  refetchConfigs: () => void;
}) {
  const { data, loading } = useQuery<any>(GET_GUARDIAN_ATHLETES, {
    variables: { organizationId: orgId },
  });
  const links: any[] = data?.myLinkedAthletes || [];

  return (
    <div>
      {/* Org header */}
      <div className="flex items-center gap-2 mb-4">
        <Building2 className="w-4 h-4 text-[#a78bfa]" />
        <h2 className="text-base font-semibold text-white">{orgName}</h2>
      </div>

      {/* Athletes */}
      <div className="mb-6">
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Athletes</p>
        {loading ? (
          <div className="flex justify-center py-6">
            <div className="w-5 h-5 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
          </div>
        ) : links.length === 0 ? (
          <div className="p-4 bg-white/5 rounded-xl border border-white/8 text-center">
            <p className="text-white/40 text-sm">No linked athletes.</p>
            <p className="text-white/25 text-xs mt-1">Ask your organization admin to send a guardian invite.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {links.map((link: any) => (
              <AthleteStatsCard key={link.id} athlete={link.athlete} organizationId={orgId} />
            ))}
          </div>
        )}
      </div>

      {/* Email reports */}
      <div>
        <p className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-3">Email Reports</p>
        <div className="bg-white/5 rounded-xl border border-white/8 p-4">
          <p className="text-xs text-white/40 mb-4">
            Choose how often you receive attendance reports for your athletes in {orgName}.
          </p>
          <OrgReportToggles
            organizationId={orgId}
            configs={orgConfigs}
            refetchConfigs={refetchConfigs}
          />
        </div>
      </div>

      <div className="border-t border-white/8 mt-8" />
    </div>
  );
}
