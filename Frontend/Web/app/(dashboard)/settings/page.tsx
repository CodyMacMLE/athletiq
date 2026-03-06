"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@apollo/client/react";
import { gql } from "@apollo/client";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { GET_ORG_SEASONS, CREATE_ORG_SEASON, UPDATE_ORG_SEASON, DELETE_ORG_SEASON, GET_ORGANIZATION, UPDATE_ORGANIZATION_SETTINGS, GET_ORGANIZATION_VENUES, CREATE_VENUE, UPDATE_VENUE, DELETE_VENUE, GET_CUSTOM_ROLES } from "@/lib/graphql";
import { GET_STRIPE_CONNECT_STATUS } from "@/lib/graphql/queries";
import { UPDATE_PAYROLL_CONFIG, CREATE_CUSTOM_ROLE, UPDATE_CUSTOM_ROLE, DELETE_CUSTOM_ROLE, CREATE_STRIPE_CONNECT_LINK, DISCONNECT_STRIPE_ACCOUNT } from "@/lib/graphql/mutations";
import { HelpCircle, Calendar, Plus, Edit2, Trash2, X, Check, Shield, Heart, Building2, Bell, DollarSign, Percent, Users, CreditCard, ExternalLink, AlertCircle, Loader2, ArrowUpRight, Zap, BarChart2, Trophy, TriangleAlert } from "lucide-react";

type PlanId = "STARTER" | "GROWTH" | "PRO";

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


const GET_ORG_SUBSCRIPTION = gql`
  query OrgSubscription($organizationId: ID!) {
    orgSubscription(organizationId: $organizationId) {
      tier
      status
      billingPeriod
      billingCurrency
      athleteLimit
      athleteCount
      currentPeriodEnd
      trialEndsAt
      stripeSubscriptionId
    }
  }
`;

const CHANGE_SUBSCRIPTION_TIER = gql`
  mutation ChangeSubscriptionTier($organizationId: ID!, $newTier: SubscriptionTier!) {
    changeSubscriptionTier(organizationId: $organizationId, newTier: $newTier) {
      checkoutUrl
      subscription {
        tier
        status
        athleteLimit
        currentPeriodEnd
      }
    }
  }
`;

const CANCEL_SUBSCRIPTION = gql`
  mutation CancelSubscription($organizationId: ID!) {
    cancelSubscription(organizationId: $organizationId) {
      tier
      status
      currentPeriodEnd
    }
  }
`;

const DELETE_ORGANIZATION = gql`
  mutation DeleteOrganization($id: ID!) {
    deleteOrganization(id: $id)
  }
`;

const RENEW_SUBSCRIPTION = gql`
  mutation RenewSubscription($organizationId: ID!) {
    renewSubscription(organizationId: $organizationId) {
      checkoutUrl
      subscription {
        tier
        status
        athleteLimit
        currentPeriodEnd
      }
    }
  }
`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

type OrgSeason = {
  id: string;
  name: string;
  startMonth: number;
  endMonth: number;
  organizationId: string;
};

type Venue = {
  id: string;
  name: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  notes?: string | null;
};

type CustomRole = {
  id: string;
  name: string;
  description?: string | null;
  canEditEvents: boolean;
  canApproveExcuses: boolean;
  canViewAnalytics: boolean;
  canManageMembers: boolean;
  canManageTeams: boolean;
  canManagePayments: boolean;
};

const PERMISSION_LABELS: { key: keyof Omit<CustomRole, "id" | "name" | "description">; label: string }[] = [
  { key: "canEditEvents", label: "Edit Events" },
  { key: "canApproveExcuses", label: "Approve Excuses" },
  { key: "canViewAnalytics", label: "View Analytics" },
  { key: "canManageMembers", label: "Manage Members" },
  { key: "canManageTeams", label: "Manage Teams" },
  { key: "canManagePayments", label: "Manage Payments" },
];

export default function SettingsPage() {
  const { selectedOrganizationId, canEdit, canManageOrg, isOwner } = useAuth();
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingSeason, setEditingSeason] = useState<OrgSeason | null>(null);
  const [formName, setFormName] = useState("");
  const [formStartMonth, setFormStartMonth] = useState(1);
  const [formEndMonth, setFormEndMonth] = useState(12);
  const [error, setError] = useState("");
  const [adminHealthAccess, setAdminHealthAccess] = useState<string>("ADMINS_ONLY");
  const [coachHealthAccess, setCoachHealthAccess] = useState<string>("TEAM_ONLY");
  const [allowCoachHourEdit, setAllowCoachHourEdit] = useState(false);
  const [healthSaving, setHealthSaving] = useState(false);
  const [healthSaved, setHealthSaved] = useState(false);
  const [coachHourSaving, setCoachHourSaving] = useState(false);
  const [coachHourSaved, setCoachHourSaved] = useState(false);
  const [reportFrequencies, setReportFrequencies] = useState<string[]>([]);
  const [reportSaving, setReportSaving] = useState(false);
  const [reportSaved, setReportSaved] = useState(false);

  // Payroll config
  type Deduction = { id: string; name: string; type: "FLAT" | "PERCENT"; value: string };
  const [payPeriod, setPayPeriod] = useState<string>("MONTHLY");
  const [defaultHourlyRate, setDefaultHourlyRate] = useState<string>("");
  const [deductions, setDeductions] = useState<Deduction[]>([]);
  const [payrollSaving, setPayrollSaving] = useState(false);
  const [payrollSaved, setPayrollSaved] = useState(false);

  // Venues
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [editingVenue, setEditingVenue] = useState<Venue | null>(null);
  const [venueForm, setVenueForm] = useState({ name: "", address: "", city: "", state: "", country: "", notes: "" });
  const [venueError, setVenueError] = useState("");

  // Stripe Connect
  const [connectLoading, setConnectLoading] = useState(false);
  const [connectError, setConnectError] = useState("");
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);

  // Renew subscription modal
  const [showRenewModal, setShowRenewModal] = useState(false);
  const [renewPlan, setRenewPlan] = useState<PlanId>("STARTER");
  const [renewCurrency, setRenewCurrency] = useState<"CAD" | "USD">("USD");

  // Delete org modal
  const [showDeleteOrgModal, setShowDeleteOrgModal] = useState(false);
  const [deleteOrgStep, setDeleteOrgStep] = useState<1 | 2>(1);
  const [deleteOrgConfirmed, setDeleteOrgConfirmed] = useState(false);
  const [deleteOrgLoading, setDeleteOrgLoading] = useState(false);
  const [deleteOrgError, setDeleteOrgError] = useState("");

  // Custom Roles
  const defaultRolePerms = { canEditEvents: false, canApproveExcuses: false, canViewAnalytics: true, canManageMembers: false, canManageTeams: false, canManagePayments: false };
  const [showRoleForm, setShowRoleForm] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [roleForm, setRoleForm] = useState<{ name: string; description: string } & typeof defaultRolePerms>({ name: "", description: "", ...defaultRolePerms });
  const [roleError, setRoleError] = useState("");

  const { data, refetch } = useQuery<any>(GET_ORG_SEASONS, {
    variables: { organizationId: selectedOrganizationId },
    skip: !selectedOrganizationId,
  });

  const { data: orgData } = useQuery<any>(GET_ORGANIZATION, {
    variables: { id: selectedOrganizationId },
    skip: !selectedOrganizationId,
  });

  useEffect(() => {
    if (orgData?.organization) {
      const org = orgData.organization;
      if (org.adminHealthAccess) setAdminHealthAccess(org.adminHealthAccess);
      if (org.coachHealthAccess) setCoachHealthAccess(org.coachHealthAccess);
      if (org.allowCoachHourEdit !== undefined) setAllowCoachHourEdit(org.allowCoachHourEdit);
      if (org.reportFrequencies) setReportFrequencies(org.reportFrequencies);
      if (org.payrollConfig) {
        if (org.payrollConfig.payPeriod) setPayPeriod(org.payrollConfig.payPeriod);
        if (org.payrollConfig.defaultHourlyRate != null) setDefaultHourlyRate(String(org.payrollConfig.defaultHourlyRate));
        if (org.payrollConfig.deductions) {
          setDeductions(org.payrollConfig.deductions.map((d: any) => ({
            id: d.id,
            name: d.name,
            type: d.type as "FLAT" | "PERCENT",
            value: String(d.value),
          })));
        }
      }
    }
  }, [orgData]);

  const [createOrgSeason] = useMutation<any>(CREATE_ORG_SEASON);
  const [updateOrgSeason] = useMutation<any>(UPDATE_ORG_SEASON);
  const [deleteOrgSeason] = useMutation<any>(DELETE_ORG_SEASON);
  const [updateOrganizationSettings] = useMutation<any>(UPDATE_ORGANIZATION_SETTINGS);
  const [updatePayrollConfig] = useMutation<any>(UPDATE_PAYROLL_CONFIG);

  const { data: venuesData, refetch: refetchVenues } = useQuery<any>(GET_ORGANIZATION_VENUES, {
    variables: { organizationId: selectedOrganizationId },
    skip: !selectedOrganizationId,
  });
  const [createVenue] = useMutation<any>(CREATE_VENUE);
  const [updateVenue] = useMutation<any>(UPDATE_VENUE);
  const [deleteVenue] = useMutation<any>(DELETE_VENUE);

  const venues: Venue[] = venuesData?.organizationVenues || [];

  const { data: rolesData, refetch: refetchRoles } = useQuery<any>(GET_CUSTOM_ROLES, {
    variables: { organizationId: selectedOrganizationId },
    skip: !selectedOrganizationId || !canManageOrg,
  });
  const [createCustomRole] = useMutation<any>(CREATE_CUSTOM_ROLE);
  const [updateCustomRole] = useMutation<any>(UPDATE_CUSTOM_ROLE);
  const [deleteCustomRole] = useMutation<any>(DELETE_CUSTOM_ROLE);
  const customRoles: CustomRole[] = rolesData?.customRoles || [];

  const { data: connectData, refetch: refetchConnect } = useQuery<any>(GET_STRIPE_CONNECT_STATUS, {
    variables: { organizationId: selectedOrganizationId },
    skip: !selectedOrganizationId || !canManageOrg,
  });
  const connectStatus = connectData?.stripeConnectStatus;
  const [createConnectLink] = useMutation<any>(CREATE_STRIPE_CONNECT_LINK);
  const [disconnectStripe] = useMutation<any>(DISCONNECT_STRIPE_ACCOUNT);

  const searchParams = useSearchParams();

  const { data: subscriptionData, refetch: refetchSubscription } = useQuery<any>(GET_ORG_SUBSCRIPTION, {
    variables: { organizationId: selectedOrganizationId },
    skip: !selectedOrganizationId || !canManageOrg,
    fetchPolicy: "cache-and-network",
  });
  const sub = subscriptionData?.orgSubscription;

  // Refetch subscription when returning from Stripe checkout.
  useEffect(() => {
    if (searchParams.get("subscription") === "success" && selectedOrganizationId && canManageOrg) {
      refetchSubscription();
    }
  }, [searchParams, selectedOrganizationId, canManageOrg]);

  // Detect locale for renew modal default currency.
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setRenewCurrency(navigator.language?.toLowerCase().endsWith("-ca") ? "CAD" : "USD");
    }
  }, []);

  // Pre-select the current plan when opening the renew modal.
  useEffect(() => {
    if (showRenewModal && sub?.tier) {
      setRenewPlan(sub.tier as PlanId);
    }
  }, [showRenewModal]);

  const [changeSubscriptionTier, { loading: tierChanging }] = useMutation<any>(CHANGE_SUBSCRIPTION_TIER);
  const [cancelSubscription, { loading: canceling }] = useMutation<any>(CANCEL_SUBSCRIPTION);
  const [renewSubscription, { loading: renewing }] = useMutation<any>(RENEW_SUBSCRIPTION);
  const [deleteOrganization] = useMutation<any>(DELETE_ORGANIZATION);

  const resetRoleForm = () => {
    setRoleForm({ name: "", description: "", ...defaultRolePerms });
    setShowRoleForm(false);
    setEditingRole(null);
    setRoleError("");
  };

  const handleCreateRole = async () => {
    if (!selectedOrganizationId || !roleForm.name.trim()) return;
    setRoleError("");
    try {
      const { name, description, ...perms } = roleForm;
      await createCustomRole({ variables: { organizationId: selectedOrganizationId, name: name.trim(), description: description.trim() || undefined, ...perms } });
      resetRoleForm();
      refetchRoles();
    } catch (err: any) {
      setRoleError(err.message || "Failed to create role");
    }
  };

  const handleUpdateRole = async () => {
    if (!editingRole) return;
    setRoleError("");
    try {
      const { name, description, ...perms } = roleForm;
      await updateCustomRole({ variables: { id: editingRole.id, name: name.trim(), description: description.trim() || undefined, ...perms } });
      resetRoleForm();
      refetchRoles();
    } catch (err: any) {
      setRoleError(err.message || "Failed to update role");
    }
  };

  const handleDeleteRole = async (role: CustomRole) => {
    if (!confirm(`Delete "${role.name}"? This cannot be undone.`)) return;
    setRoleError("");
    try {
      await deleteCustomRole({ variables: { id: role.id } });
      refetchRoles();
    } catch (err: any) {
      setRoleError(err.message || "Failed to delete role");
    }
  };

  const handleStartEditRole = (role: CustomRole) => {
    setEditingRole(role);
    setRoleForm({
      name: role.name,
      description: role.description || "",
      canEditEvents: role.canEditEvents,
      canApproveExcuses: role.canApproveExcuses,
      canViewAnalytics: role.canViewAnalytics,
      canManageMembers: role.canManageMembers,
      canManageTeams: role.canManageTeams,
      canManagePayments: role.canManagePayments,
    });
    setShowRoleForm(false);
  };

  const seasons: OrgSeason[] = data?.orgSeasons || [];

  const resetForm = () => {
    setFormName("");
    setFormStartMonth(1);
    setFormEndMonth(12);
    setShowAddForm(false);
    setEditingSeason(null);
    setError("");
  };

  const handleStartEdit = (season: OrgSeason) => {
    setEditingSeason(season);
    setFormName(season.name);
    setFormStartMonth(season.startMonth);
    setFormEndMonth(season.endMonth);
    setShowAddForm(false);
    setError("");
  };

  const handleCreate = async () => {
    if (!formName.trim()) return;
    setError("");
    try {
      await createOrgSeason({
        variables: {
          input: {
            name: formName.trim(),
            startMonth: formStartMonth,
            endMonth: formEndMonth,
            organizationId: selectedOrganizationId,
          },
        },
      });
      resetForm();
      refetch();
    } catch (err: any) {
      setError(err.message || "Failed to create season");
    }
  };

  const handleUpdate = async () => {
    if (!editingSeason || !formName.trim()) return;
    setError("");
    try {
      await updateOrgSeason({
        variables: {
          id: editingSeason.id,
          name: formName.trim(),
          startMonth: formStartMonth,
          endMonth: formEndMonth,
        },
      });
      resetForm();
      refetch();
    } catch (err: any) {
      setError(err.message || "Failed to update season");
    }
  };

  const handleSaveHealthVisibility = async () => {
    if (!selectedOrganizationId) return;
    setHealthSaving(true);
    try {
      await updateOrganizationSettings({
        variables: { id: selectedOrganizationId, adminHealthAccess, coachHealthAccess },
      });
      setHealthSaved(true);
      setTimeout(() => setHealthSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save health settings:", err);
    } finally {
      setHealthSaving(false);
    }
  };

  const handleSaveCoachHourEdit = async () => {
    if (!selectedOrganizationId) return;
    setCoachHourSaving(true);
    try {
      await updateOrganizationSettings({
        variables: { id: selectedOrganizationId, allowCoachHourEdit },
      });
      setCoachHourSaved(true);
      setTimeout(() => setCoachHourSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save coach hour setting:", err);
    } finally {
      setCoachHourSaving(false);
    }
  };

  const handleSaveReportFrequencies = async () => {
    if (!selectedOrganizationId) return;
    setReportSaving(true);
    try {
      await updateOrganizationSettings({
        variables: { id: selectedOrganizationId, reportFrequencies },
      });
      setReportSaved(true);
      setTimeout(() => setReportSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save report settings:", err);
    } finally {
      setReportSaving(false);
    }
  };

  const handleSavePayrollConfig = async () => {
    if (!selectedOrganizationId) return;
    setPayrollSaving(true);
    try {
      await updatePayrollConfig({
        variables: {
          organizationId: selectedOrganizationId,
          payPeriod,
          defaultHourlyRate: defaultHourlyRate.trim() !== "" ? parseFloat(defaultHourlyRate) : null,
          deductions: deductions
            .filter((d) => d.name.trim() && d.value.trim() && !isNaN(parseFloat(d.value)))
            .map((d) => ({ id: d.id, name: d.name.trim(), type: d.type, value: parseFloat(d.value) })),
        },
      });
      setPayrollSaved(true);
      setTimeout(() => setPayrollSaved(false), 2000);
    } catch (err) {
      console.error("Failed to save payroll config:", err);
    } finally {
      setPayrollSaving(false);
    }
  };

  const addDeduction = () => {
    setDeductions((prev) => [...prev, { id: `new_${Date.now()}`, name: "", type: "PERCENT", value: "" }]);
  };

  const updateDeduction = (id: string, field: keyof Deduction, val: string) => {
    setDeductions((prev) => prev.map((d) => (d.id === id ? { ...d, [field]: val } : d)));
  };

  const removeDeduction = (id: string) => {
    setDeductions((prev) => prev.filter((d) => d.id !== id));
  };

  const toggleReportFrequency = (value: string) => {
    setReportFrequencies((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]
    );
  };

  const handleDelete = async (season: OrgSeason) => {
    if (!confirm(`Delete "${season.name}"? This cannot be undone.`)) return;
    setError("");
    try {
      await deleteOrgSeason({ variables: { id: season.id } });
      refetch();
    } catch (err: any) {
      setError(err.message || "Failed to delete season");
    }
  };

  const resetVenueForm = () => {
    setShowVenueForm(false);
    setEditingVenue(null);
    setVenueForm({ name: "", address: "", city: "", state: "", country: "", notes: "" });
    setVenueError("");
  };

  const handleStartEditVenue = (venue: Venue) => {
    setEditingVenue(venue);
    setVenueForm({
      name: venue.name,
      address: venue.address || "",
      city: venue.city || "",
      state: venue.state || "",
      country: venue.country || "",
      notes: venue.notes || "",
    });
    setShowVenueForm(false);
    setVenueError("");
  };

  const handleCreateVenue = async () => {
    if (!venueForm.name.trim()) return;
    setVenueError("");
    try {
      await createVenue({
        variables: {
          input: {
            name: venueForm.name.trim(),
            address: venueForm.address.trim() || undefined,
            city: venueForm.city.trim() || undefined,
            state: venueForm.state.trim() || undefined,
            country: venueForm.country.trim() || undefined,
            notes: venueForm.notes.trim() || undefined,
            organizationId: selectedOrganizationId,
          },
        },
      });
      resetVenueForm();
      refetchVenues();
    } catch (err: any) {
      setVenueError(err.message || "Failed to create venue");
    }
  };

  const handleUpdateVenue = async () => {
    if (!editingVenue || !venueForm.name.trim()) return;
    setVenueError("");
    try {
      await updateVenue({
        variables: {
          id: editingVenue.id,
          input: {
            name: venueForm.name.trim(),
            address: venueForm.address.trim() || undefined,
            city: venueForm.city.trim() || undefined,
            state: venueForm.state.trim() || undefined,
            country: venueForm.country.trim() || undefined,
            notes: venueForm.notes.trim() || undefined,
          },
        },
      });
      resetVenueForm();
      refetchVenues();
    } catch (err: any) {
      setVenueError(err.message || "Failed to update venue");
    }
  };

  const handleDeleteVenue = async (venue: Venue) => {
    if (!confirm(`Delete "${venue.name}"? This cannot be undone.`)) return;
    setVenueError("");
    try {
      await deleteVenue({ variables: { id: venue.id } });
      refetchVenues();
    } catch (err: any) {
      setVenueError(err.message || "Failed to delete venue");
    }
  };

  const SeasonForm = ({ isEditing }: { isEditing: boolean }) => (
    <div className="bg-white/5 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-sm font-medium text-white/55 mb-1">Season Name</label>
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g., Hockey Season, Summer Training"
          className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
          autoFocus
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-white/55 mb-1">Start Month</label>
          <select
            value={formStartMonth}
            onChange={(e) => setFormStartMonth(Number(e.target.value))}
            className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-white/55 mb-1">End Month</label>
          <select
            value={formEndMonth}
            onChange={(e) => setFormEndMonth(Number(e.target.value))}
            className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
          >
            {MONTHS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={resetForm}
          className="px-3 py-1.5 text-sm text-white/55 hover:text-white transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={isEditing ? handleUpdate : handleCreate}
          disabled={!formName.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-4 h-4" />
          {isEditing ? "Save" : "Add Season"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-8">Settings</h1>

      {/* Seasons */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#a78bfa]" />
              <h2 className="text-lg font-semibold text-white">Seasons</h2>
            </div>
            {!showAddForm && !editingSeason && (
              <button
                onClick={() => { setShowAddForm(true); setEditingSeason(null); setError(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Season
              </button>
            )}
          </div>

          <div className="bg-white/8 rounded-lg border border-white/8 p-4">
            <p className="text-sm text-white/55 mb-4">
              Define reusable season templates for your organization. Teams can then be assigned to a season and year.
            </p>

            {error && (
              <div className="mb-4 p-3 bg-red-600/10 border border-red-600/20 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            {seasons.length > 0 && (
              <div className="space-y-2 mb-4">
                {seasons.map((season) => (
                  <div key={season.id}>
                    {editingSeason?.id === season.id ? (
                      <SeasonForm isEditing />
                    ) : (
                      <div className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg">
                        <div>
                          <span className="text-white font-medium">{season.name}</span>
                          <span className="text-white/55 text-sm ml-3">
                            {SHORT_MONTHS[season.startMonth - 1]} &rarr; {SHORT_MONTHS[season.endMonth - 1]}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleStartEdit(season)}
                            className="p-1.5 text-white/55 hover:text-white transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(season)}
                            className="p-1.5 text-white/55 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {seasons.length === 0 && !showAddForm && (
              <p className="text-white/40 text-sm text-center py-4">
                No seasons defined yet. Add one to get started.
              </p>
            )}

            {showAddForm && <SeasonForm isEditing={false} />}
          </div>
        </section>
      )}

      {/* Roles */}
      {canEdit && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Roles</h2>
          </div>
          <div className="bg-white/8 rounded-lg border border-white/8 p-4">
            <p className="text-sm text-white/55 mb-4">
              Each organization role has different permissions. Here&apos;s what each role can do:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-yellow-600/20 text-yellow-400">OWNER</span>
                </div>
                <ul className="text-xs text-white/55 space-y-1">
                  <li>Full organization control</li>
                  <li>Manage settings &amp; seasons</li>
                  <li>Manage teams &amp; users</li>
                  <li>Transfer ownership</li>
                </ul>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-[#a855f7]/15 text-[#a78bfa]">ADMIN</span>
                </div>
                <ul className="text-xs text-white/55 space-y-1">
                  <li>Manage settings &amp; seasons</li>
                  <li>Manage teams &amp; users</li>
                  <li>Attendance operations</li>
                  <li>Cannot transfer ownership</li>
                </ul>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-600/20 text-blue-400">MANAGER</span>
                </div>
                <ul className="text-xs text-white/55 space-y-1">
                  <li>Manage teams &amp; users</li>
                  <li>Attendance operations</li>
                  <li>No access to org settings</li>
                </ul>
              </div>
              <div className="bg-white/5 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-green-600/20 text-green-400">COACH</span>
                </div>
                <ul className="text-xs text-white/55 space-y-1">
                  <li>Attendance operations (own teams)</li>
                  <li>View team members</li>
                  <li>No team/user management</li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Health & Safety */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Heart className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Health &amp; Safety</h2>
          </div>
          <div className="bg-white/8 rounded-lg border border-white/8 p-4 space-y-6">
            <p className="text-sm text-white/55">
              Control who can view athlete health information, emergency contacts, and medical details.
            </p>

            {/* Admin access */}
            <div>
              <p className="text-sm font-semibold text-white mb-3">Admins</p>
              <div className="space-y-3">
                {[
                  { value: "ADMINS_ONLY", label: "Admins Only", description: "Only Owners and Admins can view health information" },
                  { value: "MANAGERS_AND_ADMINS", label: "Managers & Admins", description: "Owners, Admins, and Managers can view health information" },
                ].map((option) => (
                  <label key={option.value} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="adminHealthAccess"
                      value={option.value}
                      checked={adminHealthAccess === option.value}
                      onChange={(e) => setAdminHealthAccess(e.target.value)}
                      className="mt-0.5 accent-[#6c5ce7]"
                    />
                    <div>
                      <p className="text-sm font-medium text-white">{option.label}</p>
                      <p className="text-xs text-white/40">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-white/8" />

            {/* Coach access */}
            <div>
              <p className="text-sm font-semibold text-white mb-3">Coaches</p>
              <div className="space-y-3">
                {[
                  { value: "ORG_WIDE", label: "Org Wide", description: "Coaches can view health information for any athlete in the organization" },
                  { value: "TEAM_ONLY", label: "Team Only", description: "Coaches can only view health information for athletes on their own teams" },
                ].map((option) => (
                  <label key={option.value} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="coachHealthAccess"
                      value={option.value}
                      checked={coachHealthAccess === option.value}
                      onChange={(e) => setCoachHealthAccess(e.target.value)}
                      className="mt-0.5 accent-[#6c5ce7]"
                    />
                    <div>
                      <p className="text-sm font-medium text-white">{option.label}</p>
                      <p className="text-xs text-white/40">{option.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleSaveHealthVisibility}
              disabled={healthSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50"
            >
              {healthSaved ? <><Check className="w-4 h-4" /> Saved</> : healthSaving ? "Saving..." : <><Check className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </section>
      )}

      {/* Coach Hours */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <HelpCircle className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Coach Hours</h2>
          </div>
          <div className="bg-white/8 rounded-lg border border-white/8 p-4 space-y-4">
            <p className="text-sm text-white/55">
              Control whether coaches can edit their own check-in and check-out times on mobile. When disabled, only Admins and Managers can modify hours on the web dashboard.
            </p>
            <div
              className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg cursor-pointer hover:bg-white/8 transition-colors"
              onClick={() => setAllowCoachHourEdit(!allowCoachHourEdit)}
            >
              <div>
                <p className="text-sm font-medium text-white">Allow coaches to edit their hours</p>
                <p className="text-xs text-white/40">Coaches can modify check-in/out times directly from the mobile app</p>
              </div>
              <div className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ml-4 ${allowCoachHourEdit ? "bg-[#6c5ce7]" : "bg-white/15"}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${allowCoachHourEdit ? "translate-x-5" : "translate-x-0.5"}`} />
              </div>
            </div>
            <button
              onClick={handleSaveCoachHourEdit}
              disabled={coachHourSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50"
            >
              {coachHourSaved ? <><Check className="w-4 h-4" /> Saved</> : coachHourSaving ? "Saving..." : <><Check className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </section>
      )}

      {/* Payroll Configuration */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <DollarSign className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Payroll Configuration</h2>
          </div>
          <div className="bg-white/8 rounded-lg border border-white/8 p-4 space-y-6">
            <p className="text-sm text-white/55">
              Configure pay periods, default rates, and deductions. These settings automatically apply to payroll calculations.
            </p>

            {/* Pay period + default rate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-white/55 mb-1.5">Pay Period</label>
                <select
                  value={payPeriod}
                  onChange={(e) => setPayPeriod(e.target.value)}
                  className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
                >
                  <option value="WEEKLY">Weekly</option>
                  <option value="BIWEEKLY">Bi-weekly</option>
                  <option value="SEMI_MONTHLY">Semi-monthly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
                <p className="text-xs text-white/35 mt-1">Used for display and reporting purposes</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-white/55 mb-1.5">Default Hourly Rate ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={defaultHourlyRate}
                  onChange={(e) => setDefaultHourlyRate(e.target.value)}
                  placeholder="e.g. 20.00"
                  className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7] placeholder:text-white/25"
                />
                <p className="text-xs text-white/35 mt-1">Fallback rate for staff without individual rates set</p>
              </div>
            </div>

            <div className="border-t border-white/8" />

            {/* Deductions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-white">Deductions</p>
                <button
                  onClick={addDeduction}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-white/8 border border-white/10 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/12 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
              <p className="text-xs text-white/40 mb-3">
                Applied to each staff member&apos;s gross pay. Percentage deductions are based on gross pay; flat amounts are a fixed dollar deduction.
              </p>

              {deductions.length === 0 ? (
                <p className="text-white/30 text-sm italic py-2">No deductions configured.</p>
              ) : (
                <div className="space-y-2">
                  {/* Header */}
                  <div className="grid grid-cols-[1fr_100px_100px_32px] gap-2 px-1 text-xs font-medium text-white/35 uppercase tracking-wide">
                    <span>Name</span>
                    <span>Type</span>
                    <span>Amount</span>
                    <span />
                  </div>
                  {deductions.map((d) => (
                    <div key={d.id} className="grid grid-cols-[1fr_100px_100px_32px] gap-2 items-center">
                      <input
                        type="text"
                        value={d.name}
                        onChange={(e) => updateDeduction(d.id, "name", e.target.value)}
                        placeholder="e.g. Federal Tax"
                        className="px-2.5 py-1.5 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#6c5ce7]/60 placeholder:text-white/25"
                      />
                      <select
                        value={d.type}
                        onChange={(e) => updateDeduction(d.id, "type", e.target.value)}
                        className="px-2 py-1.5 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#6c5ce7]/60"
                      >
                        <option value="PERCENT">% Percent</option>
                        <option value="FLAT">$ Flat</option>
                      </select>
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-white/40 text-xs pointer-events-none">
                          {d.type === "PERCENT" ? "%" : "$"}
                        </span>
                        <input
                          type="number"
                          min="0"
                          step={d.type === "PERCENT" ? "0.01" : "0.01"}
                          value={d.value}
                          onChange={(e) => updateDeduction(d.id, "value", e.target.value)}
                          placeholder="0"
                          className="w-full pl-5 pr-2 py-1.5 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-[#6c5ce7]/60 placeholder:text-white/25"
                        />
                      </div>
                      <button
                        onClick={() => removeDeduction(d.id)}
                        className="p-1.5 text-white/35 hover:text-red-400 transition-colors rounded"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSavePayrollConfig}
              disabled={payrollSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50"
            >
              {payrollSaved ? <><Check className="w-4 h-4" /> Saved</> : payrollSaving ? "Saving..." : <><Check className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </section>
      )}

      {/* Venues */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#a78bfa]" />
              <h2 className="text-lg font-semibold text-white">Venues</h2>
            </div>
            {!showVenueForm && !editingVenue && (
              <button
                onClick={() => { setShowVenueForm(true); setEditingVenue(null); setVenueError(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Venue
              </button>
            )}
          </div>

          <div className="bg-white/8 rounded-lg border border-white/8 p-4">
            <p className="text-sm text-white/55 mb-4">
              Manage your organization&apos;s venues and facilities. Venues can be selected when creating events.
            </p>

            {venueError && (
              <div className="mb-4 p-3 bg-red-600/10 border border-red-600/20 rounded-lg text-red-400 text-sm">
                {venueError}
              </div>
            )}

            {venues.length > 0 && (
              <div className="space-y-2 mb-4">
                {venues.map((venue) => (
                  <div key={venue.id}>
                    {editingVenue?.id === venue.id ? (
                      <VenueForm isEditing values={venueForm} onChange={setVenueForm} onCancel={resetVenueForm} onSubmit={handleUpdateVenue} />
                    ) : (
                      <div className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg">
                        <div>
                          <span className="text-white font-medium">{venue.name}</span>
                          {(venue.city || venue.state) && (
                            <span className="text-white/55 text-sm ml-3">
                              {[venue.city, venue.state].filter(Boolean).join(", ")}
                            </span>
                          )}
                          {venue.address && (
                            <span className="text-white/40 text-xs ml-3">{venue.address}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            onClick={() => handleStartEditVenue(venue)}
                            className="p-1.5 text-white/55 hover:text-white transition-colors"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteVenue(venue)}
                            className="p-1.5 text-white/55 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {venues.length === 0 && !showVenueForm && (
              <p className="text-white/40 text-sm text-center py-4">
                No venues defined yet. Add one to get started.
              </p>
            )}

            {showVenueForm && <VenueForm isEditing={false} values={venueForm} onChange={setVenueForm} onCancel={resetVenueForm} onSubmit={handleCreateVenue} />}
          </div>
        </section>
      )}

      {/* Custom Roles */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-[#a78bfa]" />
              <h2 className="text-lg font-semibold text-white">Roles</h2>
            </div>
            {!showRoleForm && !editingRole && (
              <button
                onClick={() => { setShowRoleForm(true); setEditingRole(null); setRoleError(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add Role
              </button>
            )}
          </div>

          <div className="bg-white/8 rounded-lg border border-white/8 p-4">
            <p className="text-sm text-white/55 mb-4">
              Create custom roles with specific permission sets. Assign them to organization members for fine-grained access control.
            </p>

            {roleError && (
              <div className="mb-4 p-3 bg-red-600/10 border border-red-600/20 rounded-lg text-red-400 text-sm">
                {roleError}
              </div>
            )}

            {/* Role form (inline) */}
            {(showRoleForm || editingRole) && (
              <div className="bg-white/5 rounded-lg p-4 space-y-3 mb-4">
                <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-white/55 mb-1">Role Name</label>
                    <input
                      type="text"
                      value={roleForm.name}
                      onChange={(e) => setRoleForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="e.g., Video Coordinator"
                      className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
                      autoFocus
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-white/55 mb-1">Description (optional)</label>
                    <input
                      type="text"
                      value={roleForm.description}
                      onChange={(e) => setRoleForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Brief description of this role"
                      className="w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-white/55 mb-2">Permissions</label>
                  <div className="grid grid-cols-2 gap-2">
                    {PERMISSION_LABELS.map(({ key, label }) => (
                      <label key={key} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={roleForm[key]}
                          onChange={(e) => setRoleForm(f => ({ ...f, [key]: e.target.checked }))}
                          className="rounded border-white/20 bg-white/8 text-[#6c5ce7] focus:ring-[#6c5ce7]"
                        />
                        <span className="text-sm text-white/75">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-1">
                  <button onClick={resetRoleForm} className="px-3 py-1.5 text-sm text-white/55 hover:text-white transition-colors">
                    Cancel
                  </button>
                  <button
                    onClick={editingRole ? handleUpdateRole : handleCreateRole}
                    disabled={!roleForm.name.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Check className="w-4 h-4" />
                    {editingRole ? "Save" : "Add Role"}
                  </button>
                </div>
              </div>
            )}

            {customRoles.length > 0 && (
              <div className="space-y-2">
                {customRoles.map((role) => (
                  <div key={role.id} className="flex items-start justify-between px-3 py-2.5 bg-white/5 rounded-lg gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-medium">{role.name}</span>
                        {role.description && <span className="text-white/40 text-sm">— {role.description}</span>}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {PERMISSION_LABELS.filter(p => role[p.key]).map(p => (
                          <span key={p.key} className="px-1.5 py-0.5 bg-[#6c5ce7]/20 text-[#a78bfa] rounded text-xs">
                            {p.label}
                          </span>
                        ))}
                        {PERMISSION_LABELS.every(p => !role[p.key]) && (
                          <span className="text-white/30 text-xs italic">No permissions</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleStartEditRole(role)} className="p-1.5 text-white/55 hover:text-white transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleDeleteRole(role)} className="p-1.5 text-white/55 hover:text-red-500 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {customRoles.length === 0 && !showRoleForm && !editingRole && (
              <p className="text-white/40 text-sm text-center py-4">
                No custom roles defined yet. Add one to get started.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Attendance Reports */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Attendance Reports</h2>
          </div>
          <div className="bg-white/8 rounded-lg border border-white/8 p-4 space-y-5">
            <p className="text-sm text-white/55">
              Choose how often parents and guardians receive automated attendance reports for their athletes. Select all frequencies that apply — guardians will receive reports at each selected interval.
            </p>
            <div className="space-y-3">
              {[
                { value: "WEEKLY", label: "Weekly", description: "Every week" },
                { value: "MONTHLY", label: "Monthly", description: "Once a month" },
                { value: "QUARTERLY", label: "Quarterly", description: "Every 3 months" },
                { value: "BIANNUALLY", label: "Bi-annually", description: "Twice a year" },
                { value: "ANNUALLY", label: "Annually", description: "Once a year" },
              ].map((option) => {
                const active = reportFrequencies.includes(option.value);
                return (
                  <div
                    key={option.value}
                    className="flex items-center justify-between px-3 py-2.5 bg-white/5 rounded-lg cursor-pointer hover:bg-white/8 transition-colors"
                    onClick={() => toggleReportFrequency(option.value)}
                  >
                    <div>
                      <p className="text-sm font-medium text-white">{option.label}</p>
                      <p className="text-xs text-white/40">{option.description}</p>
                    </div>
                    {/* Toggle switch */}
                    <div
                      className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                        active ? "bg-[#6c5ce7]" : "bg-white/15"
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          active ? "translate-x-5" : "translate-x-0.5"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={handleSaveReportFrequencies}
              disabled={reportSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50"
            >
              {reportSaved ? <><Check className="w-4 h-4" /> Saved</> : reportSaving ? "Saving..." : <><Check className="w-4 h-4" /> Save</>}
            </button>
          </div>
        </section>
      )}

      {/* Stripe Connect */}
      {canManageOrg && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Stripe Payments</h2>
          </div>
          <div className="bg-white/8 rounded-lg border border-white/8 p-4 space-y-4">
            <p className="text-sm text-white/55">
              Connect a Stripe account to accept card payments on invoices. AthletiQ takes a 2% platform fee; the rest goes directly to your account.
            </p>

            {connectStatus?.connected ? (
              <div className="space-y-3">
                {/* Status badge */}
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${connectStatus.enabled ? "bg-green-400" : "bg-yellow-400"}`} />
                  <span className="text-sm text-white/80">
                    {connectStatus.enabled ? "Connected and active" : "Connected — completing onboarding"}
                  </span>
                </div>

                {!connectStatus.enabled && (
                  <div className="flex items-start gap-2 p-3 bg-yellow-600/10 border border-yellow-600/20 rounded-lg">
                    <AlertCircle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
                    <p className="text-sm text-yellow-300/80">
                      Your Stripe account is connected but not yet enabled for charges. Complete Stripe's onboarding to start accepting payments.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  {!connectStatus.enabled && (
                    <button
                      onClick={async () => {
                        setConnectLoading(true);
                        setConnectError("");
                        try {
                          const { data } = await createConnectLink({ variables: { organizationId: selectedOrganizationId } });
                          window.location.href = data.createStripeConnectLink;
                        } catch (err: any) {
                          setConnectError(err.message ?? "Failed to create onboarding link");
                          setConnectLoading(false);
                        }
                      }}
                      disabled={connectLoading}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50"
                    >
                      {connectLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      Continue onboarding
                    </button>
                  )}

                  {connectStatus.dashboardUrl && (
                    <a
                      href={connectStatus.dashboardUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/8 text-white/70 hover:text-white rounded-lg text-sm hover:bg-white/12 transition-colors border border-white/10"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Stripe dashboard
                    </a>
                  )}

                  {!disconnectConfirm ? (
                    <button
                      onClick={() => setDisconnectConfirm(true)}
                      className="px-3 py-1.5 text-sm text-red-400/70 hover:text-red-400 transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white/55">Are you sure?</span>
                      <button
                        onClick={async () => {
                          try {
                            await disconnectStripe({ variables: { organizationId: selectedOrganizationId } });
                            setDisconnectConfirm(false);
                            refetchConnect();
                          } catch (err: any) {
                            setConnectError(err.message ?? "Disconnect failed");
                          }
                        }}
                        className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 transition-colors"
                      >
                        Yes, disconnect
                      </button>
                      <button
                        onClick={() => setDisconnectConfirm(false)}
                        className="px-3 py-1.5 text-sm text-white/40 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <button
                onClick={async () => {
                  setConnectLoading(true);
                  setConnectError("");
                  try {
                    const { data } = await createConnectLink({ variables: { organizationId: selectedOrganizationId } });
                    window.location.href = data.createStripeConnectLink;
                  } catch (err: any) {
                    setConnectError(err.message ?? "Failed to create onboarding link");
                    setConnectLoading(false);
                  }
                }}
                disabled={connectLoading}
                className="flex items-center gap-1.5 px-4 py-2 bg-[#6c5ce7] text-white rounded-lg text-sm font-medium hover:bg-[#5a4dd4] transition-colors disabled:opacity-50"
              >
                {connectLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting...</>
                  : <><CreditCard className="w-4 h-4" /> Connect Stripe Account</>
                }
              </button>
            )}

            {connectError && (
              <p className="text-sm text-red-400">{connectError}</p>
            )}
          </div>
        </section>
      )}

      {/* Billing */}
      {canManageOrg && sub && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard className="w-5 h-5 text-[#a78bfa]" />
            <h2 className="text-lg font-semibold text-white">Billing &amp; Plan</h2>
          </div>

          <div className="bg-white/8 rounded-lg border border-white/8 p-4 space-y-5">
            {/* Current plan summary */}
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  {sub.tier === "STARTER" && <Zap className="w-4 h-4 text-blue-400" />}
                  {sub.tier === "GROWTH"  && <BarChart2 className="w-4 h-4 text-purple-400" />}
                  {sub.tier === "PRO"     && <Trophy className="w-4 h-4 text-yellow-400" />}
                  <span className="text-white font-semibold">{sub.tier.charAt(0) + sub.tier.slice(1).toLowerCase()} Plan</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    sub.status === "ACTIVE"   ? "bg-green-500/20 text-green-400" :
                    sub.status === "TRIALING" ? "bg-blue-500/20 text-blue-400" :
                    sub.status === "PAST_DUE" ? "bg-red-500/20 text-red-400" :
                                                "bg-white/10 text-white/45"
                  }`}>
                    {sub.status === "TRIALING" ? "Trial" :
                     sub.status === "ACTIVE"   ? "Active" :
                     sub.status === "PAST_DUE" ? "Past Due" : "Canceled"}
                  </span>
                </div>
                <p className="text-white/45 text-sm">
                  {sub.athleteCount} / {sub.athleteLimit} athletes
                  {sub.trialEndsAt && (
                    <> &mdash; Trial ends {new Date(sub.trialEndsAt).toLocaleDateString()}</>
                  )}
                  {sub.currentPeriodEnd && sub.status === "ACTIVE" && (
                    <> &mdash; Renews {new Date(sub.currentPeriodEnd).toLocaleDateString()}</>
                  )}
                </p>
              </div>
              {sub.billingCurrency && (
                <span className="text-xs text-white/30 shrink-0">
                  Billed in {sub.billingCurrency.toUpperCase()}
                </span>
              )}
            </div>

            {/* Athlete usage bar */}
            <div>
              <div className="flex justify-between text-xs text-white/45 mb-1">
                <span>Athletes</span>
                <span>{sub.athleteCount} / {sub.athleteLimit}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    sub.athleteCount / sub.athleteLimit >= 0.9 ? "bg-red-400" :
                    sub.athleteCount / sub.athleteLimit >= 0.7 ? "bg-yellow-400" : "bg-[#6c5ce7]"
                  }`}
                  style={{ width: `${Math.min(100, (sub.athleteCount / sub.athleteLimit) * 100)}%` }}
                />
              </div>
            </div>

            {/* Upgrade / downgrade */}
            {sub.status !== "CANCELED" && (
              <div>
                <p className="text-xs text-white/45 mb-2">Change plan</p>
                <div className="flex gap-2 flex-wrap">
                  {(["STARTER", "GROWTH", "PRO"] as const).filter(t => t !== sub.tier).map((tier) => (
                    <button
                      key={tier}
                      disabled={tierChanging}
                      onClick={async () => {
                        if (!confirm(`Switch to ${tier.charAt(0) + tier.slice(1).toLowerCase()} plan? Changes take effect immediately for upgrades.`)) return;
                        try {
                          const result = await changeSubscriptionTier({ variables: { organizationId: selectedOrganizationId, newTier: tier } });
                          const { checkoutUrl } = result.data?.changeSubscriptionTier ?? {};
                          if (checkoutUrl) {
                            window.location.href = checkoutUrl;
                          } else {
                            refetchSubscription();
                          }
                        } catch (err: any) {
                          alert(err.message || "Failed to change plan.");
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white/70 hover:border-[#6c5ce7]/60 hover:text-white transition-all disabled:opacity-50"
                    >
                      {tierChanging ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                      Switch to {tier.charAt(0) + tier.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Cancel / Renew */}
            <div className="pt-2 border-t border-white/8">
              {sub.status === "CANCELED" ? (
                <button
                  onClick={() => setShowRenewModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7]/20 border border-[#6c5ce7]/40 rounded-lg text-sm text-[#a78bfa] hover:bg-[#6c5ce7]/30 hover:border-[#6c5ce7]/60 transition-all"
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Renew subscription
                </button>
              ) : (sub.status === "ACTIVE" || sub.status === "TRIALING") && (
                <button
                  disabled={canceling}
                  onClick={async () => {
                    if (!confirm("Cancel your subscription? You keep access until the end of the current period.")) return;
                    try {
                      await cancelSubscription({ variables: { organizationId: selectedOrganizationId } });
                      refetchSubscription();
                    } catch (err: any) {
                      alert(err.message || "Failed to cancel.");
                    }
                  }}
                  className="text-sm text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-50"
                >
                  {canceling ? "Canceling…" : "Cancel subscription"}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Renew Subscription Modal */}
      {showRenewModal && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1e1845] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-sm shadow-2xl">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-base font-semibold text-white">Renew Subscription</h2>
              <button onClick={() => setShowRenewModal(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-white/45 text-sm mb-4">Choose a plan to continue with.</p>

            {/* Currency toggle */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-white/45">Currency</span>
              <div className="flex rounded-lg overflow-hidden border border-white/10">
                {(["CAD", "USD"] as const).map((cur) => (
                  <button
                    key={cur}
                    type="button"
                    onClick={() => setRenewCurrency(cur)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      renewCurrency === cur ? "bg-[#6c5ce7] text-white" : "bg-white/5 text-white/45 hover:text-white/70"
                    }`}
                  >
                    {cur}
                  </button>
                ))}
              </div>
            </div>

            {/* Plan cards */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {PLAN_OPTIONS.map(({ id, name, athletes, Icon, iconColor, iconBg, pricing }) => {
                const selected = renewPlan === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setRenewPlan(id)}
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
                    <p className="text-[#a78bfa] text-xs font-bold">
                      {pricing[renewCurrency]}<span className="text-white/30 font-normal">/mo</span>
                    </p>
                    <p className="text-white/35 text-[10px] mt-0.5">{athletes} athletes</p>
                  </button>
                );
              })}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => setShowRenewModal(false)}
                className="px-4 py-2 bg-white/8 hover:bg-white/12 text-white/65 text-sm font-medium rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={renewing}
                onClick={async () => {
                  try {
                    const result = await renewSubscription({
                      variables: {
                        organizationId: selectedOrganizationId,
                        tier: renewPlan,
                        currency: renewCurrency.toLowerCase(),
                      },
                    });
                    const { checkoutUrl } = result.data?.renewSubscription ?? {};
                    if (checkoutUrl) {
                      window.location.href = checkoutUrl;
                    } else {
                      setShowRenewModal(false);
                      refetchSubscription();
                    }
                  } catch (err: any) {
                    alert(err.message || "Failed to renew subscription.");
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-[#6c5ce7] hover:bg-[#5a4dd4] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
              >
                {renewing ? <><Loader2 className="w-4 h-4 animate-spin" /> Renewing…</> : "Continue →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Help & Support */}
      <section className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <HelpCircle className="w-5 h-5 text-[#a78bfa]" />
          <h2 className="text-lg font-semibold text-white">Help &amp; Support</h2>
        </div>
        <div className="bg-white/8 rounded-lg border border-white/8 p-4">
          <p className="text-sm text-white/75 mb-3">
            Need help or have feedback? Reach out to us.
          </p>
          <a
            href="mailto:admin@athletiq.fitness"
            className="inline-block text-sm text-[#a78bfa] hover:text-[#c4b5fd] transition-colors"
          >
            admin@athletiq.fitness
          </a>
        </div>
      </section>

      {/* Danger Zone — owners only */}
      {isOwner && (
        <section className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <TriangleAlert className="w-5 h-5 text-red-400" />
            <h2 className="text-lg font-semibold text-red-400">Danger Zone</h2>
          </div>
          <div className="bg-red-500/5 rounded-lg border border-red-500/20 p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-white">Delete Organization</p>
              <p className="text-xs text-white/45 mt-0.5">
                Permanently delete this organization and all of its data.
              </p>
            </div>
            <button
              onClick={() => {
                setDeleteOrgStep(sub?.status === "ACTIVE" ? 1 : 2);
                setDeleteOrgConfirmed(false);
                setDeleteOrgError("");
                setShowDeleteOrgModal(true);
              }}
              className="shrink-0 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium transition-colors"
            >
              Delete Organization
            </button>
          </div>
        </section>
      )}

      {/* Delete Organization Modal */}
      {showDeleteOrgModal && (
        <div className="fixed inset-0 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-[#1a1035] backdrop-blur-xl rounded-xl border border-white/15 p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TriangleAlert className="w-5 h-5 text-red-400" />
                <h2 className="text-base font-semibold text-white">Delete Organization</h2>
              </div>
              <button
                onClick={() => setShowDeleteOrgModal(false)}
                className="text-white/40 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Step 1 — must cancel subscription first */}
            {deleteOrgStep === 1 && (
              <div>
                <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 mb-4">
                  <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-sm text-amber-200">
                    Your subscription is currently <span className="font-semibold">active</span>. You must cancel it before deleting this organization.
                  </p>
                </div>
                <p className="text-sm text-white/55 mb-5">
                  After canceling, your access continues until the end of the current billing period. Once the subscription is canceled you can return here to delete the organization.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowDeleteOrgModal(false)}
                    className="px-4 py-2 text-sm text-white/55 hover:text-white transition-colors"
                  >
                    Close
                  </button>
                  <button
                    disabled={canceling}
                    onClick={async () => {
                      try {
                        await cancelSubscription({ variables: { organizationId: selectedOrganizationId } });
                        await refetchSubscription();
                        setDeleteOrgStep(2);
                      } catch (err: any) {
                        setDeleteOrgError(err.message || "Failed to cancel subscription.");
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
                  >
                    {canceling ? <><Loader2 className="w-4 h-4 animate-spin" /> Canceling…</> : "Cancel Subscription"}
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 — confirm deletion */}
            {deleteOrgStep === 2 && (
              <div>
                <p className="text-sm text-white/70 mb-4">
                  This will permanently delete <span className="font-semibold text-white">{orgData?.organization?.name}</span> and all of its data. This cannot be undone.
                </p>
                <ul className="space-y-2 mb-5">
                  {[
                    "All teams and team members will be removed",
                    "All events and attendance records will be deleted",
                    "All announcements, invoices, and payments will be deleted",
                    "Member accounts are kept — they simply lose access to this org",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm text-white/55">
                      <span className="text-red-400 mt-0.5 shrink-0">✕</span>
                      {item}
                    </li>
                  ))}
                </ul>

                <label className="flex items-start gap-3 cursor-pointer mb-5 select-none">
                  <div className="relative mt-0.5">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={deleteOrgConfirmed}
                      onChange={(e) => setDeleteOrgConfirmed(e.target.checked)}
                    />
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      deleteOrgConfirmed ? "bg-red-500 border-red-500" : "border-white/30 bg-white/5"
                    }`}>
                      {deleteOrgConfirmed && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                  <span className="text-sm text-white/70">
                    I understand that this action is <span className="text-white font-medium">permanent and irreversible</span>.
                  </span>
                </label>

                {deleteOrgError && (
                  <p className="text-sm text-red-400 mb-3">{deleteOrgError}</p>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowDeleteOrgModal(false)}
                    className="px-4 py-2 text-sm text-white/55 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={!deleteOrgConfirmed || deleteOrgLoading}
                    onClick={async () => {
                      setDeleteOrgLoading(true);
                      setDeleteOrgError("");
                      try {
                        await deleteOrganization({ variables: { id: selectedOrganizationId } });
                        // Reload to clear org context — user will land on org picker / onboarding
                        window.location.href = "/";
                      } catch (err: any) {
                        setDeleteOrgError(err.message || "Failed to delete organization.");
                        setDeleteOrgLoading(false);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {deleteOrgLoading
                      ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting…</>
                      : "Delete Organization"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

type VenueFormValues = { name: string; address: string; city: string; state: string; country: string; notes: string };

function VenueForm({
  isEditing,
  values,
  onChange,
  onCancel,
  onSubmit,
}: {
  isEditing: boolean;
  values: VenueFormValues;
  onChange: (updater: (prev: VenueFormValues) => VenueFormValues) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const inputClass = "w-full px-3 py-2 bg-white/8 border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#6c5ce7]";

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, nextId?: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (nextId) {
        document.getElementById(nextId)?.focus();
      } else {
        onSubmit();
      }
    }
  };

  return (
    <div className="bg-white/5 rounded-lg p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-white/55 mb-1">Venue Name *</label>
          <input
            id="vf-name"
            type="text"
            value={values.name}
            onChange={(e) => onChange(f => ({ ...f, name: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, "vf-address")}
            placeholder="Main Gym"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/55 mb-1">Address</label>
          <input
            id="vf-address"
            type="text"
            value={values.address}
            onChange={(e) => onChange(f => ({ ...f, address: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, "vf-city")}
            placeholder="123 Main St."
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/55 mb-1">City</label>
          <input
            id="vf-city"
            type="text"
            value={values.city}
            onChange={(e) => onChange(f => ({ ...f, city: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, "vf-state")}
            placeholder="Toronto"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/55 mb-1">State / Province</label>
          <input
            id="vf-state"
            type="text"
            value={values.state}
            onChange={(e) => onChange(f => ({ ...f, state: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, "vf-country")}
            placeholder="ON"
            className={inputClass}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-white/55 mb-1">Country</label>
          <input
            id="vf-country"
            type="text"
            value={values.country}
            onChange={(e) => onChange(f => ({ ...f, country: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e, "vf-notes")}
            placeholder="Canada"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-white/55 mb-1">Notes</label>
          <input
            id="vf-notes"
            type="text"
            value={values.notes}
            onChange={(e) => onChange(f => ({ ...f, notes: e.target.value }))}
            onKeyDown={(e) => handleKeyDown(e)}
            placeholder="Parking info, entrance details, etc."
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-white/55 hover:text-white transition-colors">
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={!values.name.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#6c5ce7] text-white rounded-lg text-sm hover:bg-[#5a4dd4] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Check className="w-4 h-4" />
          {isEditing ? "Save" : "Add Venue"}
        </button>
      </div>
    </div>
  );
}
