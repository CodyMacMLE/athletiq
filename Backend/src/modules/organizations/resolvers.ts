import { prisma } from "../../db.js";
import { OrgRole, TeamRole } from "@prisma/client";
import { sendInviteEmail } from "../../email.js";
import { requireOrgAdmin, requireOrgOwner, requireActiveSubscription, enforceAthleteLimit } from "../../utils/permissions.js";
import { auditLog } from "../../utils/audit.js";
import { toISO } from "../../utils/time.js";
import type { Loaders } from "../../utils/dataLoaders.js";

interface Context {
  userId?: string;
  loaders: Loaders;
}

export const organizationResolvers = {
  Query: {
    organization: async (_: unknown, { id }: { id: string }) => {
      return prisma.organization.findUnique({ where: { id } });
    },

    organizations: async () => {
      return prisma.organization.findMany();
    },

    myOrganizations: async (_: unknown, __: unknown, context: { userId?: string }) => {
      if (!context.userId) return [];
      const memberships = await prisma.organizationMember.findMany({
        where: { userId: context.userId },
        include: { organization: true },
      });
      return memberships.map((m) => m.organization);
    },

    // Season queries
    orgSeasons: async (_: unknown, { organizationId }: { organizationId: string }) => {
      return prisma.orgSeason.findMany({
        where: { organizationId },
        orderBy: { name: "asc" },
      });
    },

    // Invite queries
    invite: async (_: unknown, { token }: { token: string }) => {
      return prisma.invite.findUnique({ where: { token } });
    },

    myPendingInvites: async (_: unknown, __: unknown, context: { userId?: string }) => {
      if (!context.userId) throw new Error("Authentication required");
      const user = await prisma.user.findUnique({ where: { id: context.userId }, select: { email: true } });
      if (!user) throw new Error("User not found");
      return prisma.invite.findMany({
        where: {
          email: { equals: user.email, mode: "insensitive" },
          status: "PENDING",
          expiresAt: { gt: new Date() },
        },
      });
    },
  },

  Mutation: {
    // Organization mutations
    createOrganization: async (_: unknown, { input }: { input: { name: string; image?: string } }, context: { userId?: string }) => {
      if (!context.userId) throw new Error("Authentication required");

      const org = await prisma.organization.create({ data: input });
      await prisma.organizationMember.create({
        data: {
          userId: context.userId,
          organizationId: org.id,
          role: "OWNER",
        },
      });
      return org;
    },

    updateOrganization: async (_: unknown, { id, name, image }: { id: string; name?: string; image?: string }) => {
      return prisma.organization.update({
        where: { id },
        data: { ...(name && { name }), ...(image && { image }) },
      });
    },

    deleteOrganization: async (_: unknown, { id }: { id: string }, context: { userId?: string }) => {
      const actorId = await requireOrgOwner(context, id);
      await prisma.organization.delete({ where: { id } });
      await auditLog({ action: "DELETE_ORGANIZATION", actorId, targetId: id, targetType: "Organization", organizationId: id });
      return true;
    },

    // Organization member mutations
    addOrgMember: async (
      _: unknown,
      { input }: { input: { userId: string; organizationId: string; role?: OrgRole } },
      context: { userId?: string }
    ) => {
      await requireOrgAdmin(context, input.organizationId);
      await requireActiveSubscription(input.organizationId);
      const role = input.role || "ATHLETE";
      if (role === "ATHLETE") {
        await enforceAthleteLimit(input.organizationId);
      }
      return prisma.organizationMember.upsert({
        where: {
          userId_organizationId: {
            userId: input.userId,
            organizationId: input.organizationId,
          },
        },
        update: {},
        create: {
          userId: input.userId,
          organizationId: input.organizationId,
          role,
        },
      });
    },

    updateOrgMemberRole: async (
      _: unknown,
      { userId, organizationId, role }: { userId: string; organizationId: string; role: OrgRole },
      context: { userId?: string }
    ) => {
      const actorId = await requireOrgAdmin(context, organizationId);
      const result = await prisma.organizationMember.update({
        where: { userId_organizationId: { userId, organizationId } },
        data: { role },
      });
      await auditLog({ action: "UPDATE_MEMBER_ROLE", actorId, targetId: userId, targetType: "User", organizationId, metadata: { role } });
      return result;
    },

    removeOrgMember: async (_: unknown, { userId, organizationId }: { userId: string; organizationId: string }, context: { userId?: string }) => {
      // Look up the target member's role
      const targetMember = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId, organizationId } },
      });
      if (!targetMember) throw new Error("Member not found");

      // Owner can never be removed
      if (targetMember.role === "OWNER") {
        throw new Error("The organization owner cannot be removed");
      }

      // Non-owner callers cannot remove ADMINs; non-owner/non-admin callers cannot remove MANAGERs
      if (context.userId) {
        const callerMember = await prisma.organizationMember.findUnique({
          where: { userId_organizationId: { userId: context.userId, organizationId } },
        });
        if (callerMember && callerMember.role !== "OWNER") {
          if (targetMember.role === "ADMIN") {
            throw new Error("Only the owner can remove admins");
          }
          if (targetMember.role === "MANAGER" && callerMember.role !== "ADMIN") {
            throw new Error("Only the owner or an admin can remove managers");
          }
          if (userId === context.userId) {
            throw new Error("You cannot remove yourself from the organization");
          }
        }
      }

      // Find all teams in this organization
      const orgTeams = await prisma.team.findMany({
        where: { organizationId },
        select: { id: true },
      });
      const teamIds = orgTeams.map((t) => t.id);

      // Remove user from all teams in this org, then remove org membership and report configs
      await prisma.$transaction([
        prisma.teamMember.deleteMany({
          where: { userId, teamId: { in: teamIds } },
        }),
        prisma.emailReportConfig.deleteMany({
          where: { userId, organizationId },
        }),
        prisma.organizationMember.delete({
          where: { userId_organizationId: { userId, organizationId } },
        }),
      ]);
      return true;
    },

    leaveOrganization: async (_: unknown, { organizationId }: { organizationId: string }, context: { userId?: string }) => {
      if (!context.userId) throw new Error("Authentication required");

      const member = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: context.userId, organizationId } },
      });
      if (!member) throw new Error("You are not a member of this organization");
      if (member.role === "OWNER") throw new Error("Owners cannot leave the organization. Transfer ownership first.");

      const orgTeams = await prisma.team.findMany({
        where: { organizationId },
        select: { id: true },
      });
      const teamIds = orgTeams.map((t) => t.id);

      await prisma.$transaction([
        prisma.teamMember.deleteMany({
          where: { userId: context.userId, teamId: { in: teamIds } },
        }),
        prisma.emailReportConfig.deleteMany({
          where: { userId: context.userId, organizationId },
        }),
        prisma.organizationMember.delete({
          where: { userId_organizationId: { userId: context.userId, organizationId } },
        }),
      ]);
      return true;
    },

    transferOwnership: async (_: unknown, { organizationId, newOwnerId }: { organizationId: string; newOwnerId: string }, context: { userId?: string }) => {
      const actorId = await requireOrgOwner(context, organizationId);
      if (newOwnerId === context.userId) throw new Error("You are already the owner");

      const newOwnerMember = await prisma.organizationMember.findUnique({
        where: { userId_organizationId: { userId: newOwnerId, organizationId } },
      });
      if (!newOwnerMember) throw new Error("The selected user is not a member of this organization");

      await prisma.$transaction([
        prisma.organizationMember.update({
          where: { userId_organizationId: { userId: newOwnerId, organizationId } },
          data: { role: "OWNER" },
        }),
        prisma.organizationMember.update({
          where: { userId_organizationId: { userId: actorId, organizationId } },
          data: { role: "ADMIN" },
        }),
      ]);
      await auditLog({ action: "TRANSFER_OWNERSHIP", actorId, targetId: newOwnerId, targetType: "User", organizationId });
      return true;
    },

    // Season mutations
    createOrgSeason: async (_: unknown, { input }: { input: { name: string; startMonth: number; endMonth: number; organizationId: string } }) => {
      if (input.startMonth < 1 || input.startMonth > 12 || input.endMonth < 1 || input.endMonth > 12) {
        throw new Error("Months must be between 1 and 12");
      }
      return prisma.orgSeason.create({ data: input });
    },

    updateOrgSeason: async (_: unknown, { id, name, startMonth, endMonth }: { id: string; name?: string; startMonth?: number; endMonth?: number }) => {
      if ((startMonth !== undefined && (startMonth < 1 || startMonth > 12)) ||
          (endMonth !== undefined && (endMonth < 1 || endMonth > 12))) {
        throw new Error("Months must be between 1 and 12");
      }
      return prisma.orgSeason.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(startMonth !== undefined && { startMonth }),
          ...(endMonth !== undefined && { endMonth }),
        },
      });
    },

    deleteOrgSeason: async (_: unknown, { id }: { id: string }) => {
      const teamsUsingThis = await prisma.team.count({ where: { orgSeasonId: id } });
      if (teamsUsingThis > 0) {
        throw new Error(`Cannot delete season: ${teamsUsingThis} team(s) are still assigned to it`);
      }
      await prisma.orgSeason.delete({ where: { id } });
      return true;
    },

    // Invite mutations
    createInvite: async (
      _: unknown,
      { input }: { input: { email: string; organizationId: string; role?: OrgRole; teamIds?: string[] } },
      context: { userId?: string }
    ) => {
      await requireOrgAdmin(context, input.organizationId);
      await requireActiveSubscription(input.organizationId);
      const inviteRole = input.role || "ATHLETE";
      if (inviteRole === "ATHLETE") {
        await enforceAthleteLimit(input.organizationId);
      }
      // Check if email is already an active org member
      const existingMember = await prisma.organizationMember.findFirst({
        where: {
          organizationId: input.organizationId,
          user: { email: input.email },
        },
      });
      if (existingMember) {
        throw new Error("This email is already a member of the organization");
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invite = await prisma.invite.upsert({
        where: {
          email_organizationId: {
            email: input.email,
            organizationId: input.organizationId,
          },
        },
        update: {
          role: input.role || "ATHLETE",
          teamIds: input.teamIds || [],
          status: "PENDING",
          expiresAt,
        },
        create: {
          email: input.email,
          organizationId: input.organizationId,
          role: input.role || "ATHLETE",
          teamIds: input.teamIds || [],
          expiresAt,
        },
      });

      // Send invite email (non-blocking — admin can resend if it fails)
      try {
        const org = await prisma.organization.findUnique({ where: { id: input.organizationId } });
        if (org) {
          await sendInviteEmail({
            to: input.email,
            organizationName: org.name,
            role: invite.role,
            token: invite.token,
          });
        }
      } catch (err) {
        console.error("Failed to send invite email:", err);
      }

      return invite;
    },

    acceptInvite: async (
      _: unknown,
      { token }: { token: string },
      context: { userId?: string }
    ) => {
      if (!context.userId) throw new Error("Authentication required");

      const invite = await prisma.invite.findUnique({ where: { token } });
      if (!invite) throw new Error("Invite not found");
      if (invite.status !== "PENDING") throw new Error("Invite is no longer valid");
      if (invite.expiresAt < new Date()) throw new Error("Invite has expired");

      await requireActiveSubscription(invite.organizationId);
      if (invite.role === "ATHLETE") {
        await enforceAthleteLimit(invite.organizationId);
      }

      const result = await prisma.$transaction(async (tx) => {
        // Upsert org membership
        const orgMember = await tx.organizationMember.upsert({
          where: {
            userId_organizationId: {
              userId: context.userId!,
              organizationId: invite.organizationId,
            },
          },
          update: {},
          create: {
            userId: context.userId!,
            organizationId: invite.organizationId,
            role: invite.role,
          },
        });

        // For guardian invites, create a GuardianLink instead of team memberships
        if (invite.role === "GUARDIAN" && invite.athleteId) {
          // Hard-enforce no circular guardian relationships (org-independent):
          // Reject if the athlete being guarded is already a guardian of the acceptor.
          const circularLink = await tx.guardianLink.findFirst({
            where: { guardianId: invite.athleteId, athleteId: context.userId! },
          });
          if (circularLink) {
            throw new Error(
              "Mutual guardian relationships are not allowed. This athlete is already your guardian."
            );
          }

          // Prevent org athletes from becoming guardians for other org members.
          // Check whether the acceptor is an ATHLETE in the same organization.
          const acceptorOrgMembership = await tx.organizationMember.findUnique({
            where: {
              userId_organizationId: {
                userId: context.userId!,
                organizationId: invite.organizationId,
              },
            },
          });
          if (acceptorOrgMembership?.role === "ATHLETE") {
            throw new Error(
              "You are an athlete in this organization. To be a guardian here, an admin must change your org role to Guardian first."
            );
          }

          await tx.guardianLink.upsert({
            where: {
              guardianId_athleteId_organizationId: {
                guardianId: context.userId!,
                athleteId: invite.athleteId,
                organizationId: invite.organizationId,
              },
            },
            update: {},
            create: {
              guardianId: context.userId!,
              athleteId: invite.athleteId,
              organizationId: invite.organizationId,
            },
          });
        } else {
          // Add to teams with role derived from invite org role
          const teamRole: TeamRole =
            invite.role === "COACH" ? "COACH" :
            ["ADMIN", "MANAGER"].includes(invite.role) ? "ADMIN" :
            "MEMBER";
          for (const teamId of invite.teamIds) {
            await tx.teamMember.upsert({
              where: { userId_teamId: { userId: context.userId!, teamId } },
              update: {},
              create: {
                userId: context.userId!,
                teamId,
                role: teamRole,
              },
            });
          }
        }

        // Mark invite as accepted
        await tx.invite.update({
          where: { id: invite.id },
          data: { status: "ACCEPTED" },
        });

        return orgMember;
      });

      return result;
    },

    cancelInvite: async (_: unknown, { id }: { id: string }) => {
      await prisma.invite.delete({ where: { id } });
      return true;
    },

    resendInvite: async (_: unknown, { id }: { id: string }) => {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const invite = await prisma.invite.update({
        where: { id },
        data: {
          status: "PENDING",
          expiresAt,
        },
      });

      try {
        const org = await prisma.organization.findUnique({ where: { id: invite.organizationId } });
        if (org) {
          await sendInviteEmail({
            to: invite.email,
            organizationName: org.name,
            role: invite.role,
            token: invite.token,
          });
        }
      } catch (err) {
        console.error("Failed to resend invite email:", err);
      }

      return invite;
    },
  },

  Organization: {
    teams: (parent: { id: string }) => prisma.team.findMany({ where: { organizationId: parent.id, archivedAt: null } }),
    events: (parent: { id: string }) => prisma.event.findMany({ where: { organizationId: parent.id, isAdHoc: false } }),
    members: (parent: { id: string }) =>
      prisma.organizationMember.findMany({ where: { organizationId: parent.id } }),
    invites: (parent: { id: string }) =>
      prisma.invite.findMany({ where: { organizationId: parent.id, status: "PENDING" } }),
    nfcTags: (parent: { id: string }) =>
      prisma.nfcTag.findMany({ where: { organizationId: parent.id, isActive: true } }),
    seasons: (parent: { id: string }) =>
      prisma.orgSeason.findMany({ where: { organizationId: parent.id }, orderBy: { name: "asc" } }),
    memberCount: async (parent: { id: string }) => {
      return prisma.teamMember.count({
        where: { team: { organizationId: parent.id, archivedAt: null }, role: { in: ["MEMBER", "CAPTAIN"] as TeamRole[] } },
      });
    },
    payrollConfig: (parent: any) => {
      const config = parent.payrollConfig as any;
      if (!config) return { payPeriod: null, defaultHourlyRate: null, deductions: [] };
      return {
        payPeriod: config.payPeriod ?? null,
        defaultHourlyRate: config.defaultHourlyRate ?? null,
        deductions: (config.deductions ?? []).map((d: any) => ({
          id: d.id ?? String(Math.random()),
          name: d.name,
          type: d.type,
          value: d.value,
        })),
      };
    },
    createdAt: (parent: any) => toISO(parent.createdAt),
    updatedAt: (parent: any) => toISO(parent.updatedAt),
  },

  OrgSeason: {
    createdAt: (parent: any) => toISO(parent.createdAt),
    updatedAt: (parent: any) => toISO(parent.updatedAt),
  },

  OrganizationMember: {
    user: (parent: { userId: string }, _: unknown, context: Context) =>
      context.loaders.user.load(parent.userId),
    organization: (parent: { organizationId: string }, _: unknown, context: Context) =>
      context.loaders.organization.load(parent.organizationId),
    joinedAt: (parent: any) => toISO(parent.joinedAt),
    customRole: (parent: { customRoleId?: string | null }) =>
      parent.customRoleId ? prisma.customRole.findUnique({ where: { id: parent.customRoleId } }) : null,
  },

  Invite: {
    organization: (parent: { organizationId: string }, _: unknown, context: Context) =>
      context.loaders.organization.load(parent.organizationId),
    createdAt: (parent: any) => toISO(parent.createdAt),
    expiresAt: (parent: any) => toISO(parent.expiresAt),
  },
};
