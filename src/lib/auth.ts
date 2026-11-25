import crypto from "node:crypto";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { eq, and, asc } from "drizzle-orm";
import { db, ensureDatabaseReady } from "@/db";
import {
  companies,
  companyInvitations,
  companyMemberships,
  numberSequences,
  userPreferences,
  type Company,
} from "@/db/schema";
import { isClerkConfigured } from "./clerk-config";
import { isEmailAllowed } from "./access";

export interface AuthContext {
  clerkUserId: string;
  userEmail: string;
  userName: string;
  activeCompany: Company;
  companies: Company[];
  role: string;
}

interface CachedClerkProfile {
  email: string;
  name: string;
  expiresAt: number;
}

const CLERK_PROFILE_TTL_MS = 5 * 60 * 1000; // 5 min in-memory cache per warm instance
const INVITE_CHECK_TTL_MS = 60 * 1000; // 1 min throttle for pending-invite scan

const globalAuthCache = globalThis as unknown as {
  __manymyClerkProfiles?: Map<string, CachedClerkProfile>;
  __manymyInviteChecks?: Map<string, number>;
  __manymyAvatarSynced?: Set<string>;
};

function getAvatarSyncSet(): Set<string> {
  if (!globalAuthCache.__manymyAvatarSynced) {
    globalAuthCache.__manymyAvatarSynced = new Set();
  }
  return globalAuthCache.__manymyAvatarSynced;
}

async function syncGoogleAvatarToClerk(userId: string): Promise<void> {
  const secret = process.env.CLERK_SECRET_KEY?.trim();
  if (!secret) return;
  const synced = getAvatarSyncSet();
  if (synced.has(userId)) return;
  synced.add(userId);

  try {
    const tokenRes = await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/oauth_access_tokens/oauth_google`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!tokenRes.ok) return;
    const tokens = (await tokenRes.json()) as Array<{ token?: string }>;
    const accessToken = tokens[0]?.token;
    if (!accessToken) return;

    const infoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!infoRes.ok) return;
    const info = (await infoRes.json()) as { picture?: string };
    const pictureUrl = info.picture?.trim();
    if (!pictureUrl) return;

    const imgRes = await fetch(pictureUrl);
    if (!imgRes.ok) return;
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    const buf = await imgRes.arrayBuffer();
    const ext = contentType.includes("png") ? "png" : "jpg";

    const form = new FormData();
    form.append("file", new Blob([buf], { type: contentType }), `avatar.${ext}`);
    await fetch(
      `https://api.clerk.com/v1/users/${encodeURIComponent(userId)}/profile_image`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
        body: form,
      },
    );
  } catch {
    // Non-blocking best-effort avatar sync
  }
}

function getProfileCache(): Map<string, CachedClerkProfile> {
  if (!globalAuthCache.__manymyClerkProfiles) {
    globalAuthCache.__manymyClerkProfiles = new Map();
  }
  return globalAuthCache.__manymyClerkProfiles;
}

function getInviteCheckCache(): Map<string, number> {
  if (!globalAuthCache.__manymyInviteChecks) {
    globalAuthCache.__manymyInviteChecks = new Map();
  }
  return globalAuthCache.__manymyInviteChecks;
}

async function resolveClerkProfile(userId: string): Promise<{ email: string; name: string }> {
  const now = Date.now();
  const profileCache = getProfileCache();
  const cached = profileCache.get(userId);
  if (cached && cached.expiresAt > now) {
    return { email: cached.email, name: cached.name };
  }

  const user = await currentUser();
  if (user && !user.hasImage) {
    const hasGoogle = user.externalAccounts?.some((a) => a.provider === "oauth_google");
    if (hasGoogle) {
      void syncGoogleAvatarToClerk(userId);
    }
  }
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "";
  const name =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() ||
    user?.username ||
    email.split("@")[0] ||
    "Uživatel";

  if (email) {
    profileCache.set(userId, { email, name, expiresAt: now + CLERK_PROFILE_TTL_MS });
  }
  return { email, name };
}

export async function provisionDefaultCompanyForUser(
  clerkUserId: string,
  userName: string,
  userEmail: string,
): Promise<Company> {
  await ensureDatabaseReady();
  const now = new Date().toISOString();
  const year = new Date().getFullYear();
  const companyId = crypto.randomUUID();
  const companyName = userName ? `${userName}` : "Moje firma";

  await db.insert(companies).values({
    id: companyId,
    name: companyName,
    ico: "",
    dic: "",
    vatPayer: true,
    vatPeriod: "monthly",
    street: "",
    city: "",
    zip: "",
    country: "Česká republika",
    email: userEmail,
    phone: "",
    web: "",
    registryNote: "",
    defaultDueDays: 14,
    defaultVatRate: 21,
    defaultCurrency: "CZK",
    defaultRounding: false,
    defaultNoteBefore: "",
    defaultNoteAfter: "Děkujeme za spolupráci.",
    annualPlanMinor: 250000000,
    createdAt: now,
    updatedAt: now,
  });

  await Promise.all([
    db.insert(companyMemberships).values({
      id: crypto.randomUUID(),
      companyId,
      clerkUserId,
      role: "owner",
      createdAt: now,
    }),
    db.insert(numberSequences).values({
      id: crypto.randomUUID(),
      companyId,
      docType: "invoice",
      name: "Vydané faktury",
      prefix: "",
      year,
      nextNumber: 1,
      padding: 4,
      isDefault: true,
      createdAt: now,
    }),
    db
      .insert(userPreferences)
      .values({
        clerkUserId,
        activeCompanyId: companyId,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.clerkUserId,
        set: { activeCompanyId: companyId, updatedAt: now },
      }),
  ]);

  const [created] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, companyId));
  return created;
}

async function computeAuthContext(): Promise<AuthContext | null> {
  if (!isClerkConfigured()) {
    return null;
  }

  const [{ userId }] = await Promise.all([auth(), ensureDatabaseReady()]);
  if (!userId) return null;

  const { email: userEmail, name: userName } = await resolveClerkProfile(userId);
  if (!isEmailAllowed(userEmail)) {
    return null;
  }

  // Throttle pending-invitation scan to at most once per 60s per warm user
  const inviteCache = getInviteCheckCache();
  const lastInviteCheck = inviteCache.get(userId) ?? 0;
  const shouldCheckInvites = Boolean(userEmail) && Date.now() - lastInviteCheck > INVITE_CHECK_TTL_MS;

  if (shouldCheckInvites) {
    inviteCache.set(userId, Date.now());
    const pendingInvites = await db
      .select()
      .from(companyInvitations)
      .where(
        and(
          eq(companyInvitations.email, userEmail.toLowerCase()),
          eq(companyInvitations.status, "pending"),
        ),
      );
    for (const inv of pendingInvites) {
      await Promise.all([
        db
          .insert(companyMemberships)
          .values({
            id: crypto.randomUUID(),
            companyId: inv.companyId,
            clerkUserId: userId,
            role: inv.role,
            createdAt: new Date().toISOString(),
          })
          .onConflictDoNothing(),
        db
          .update(companyInvitations)
          .set({ status: "accepted" })
          .where(eq(companyInvitations.id, inv.id)),
      ]);
    }
  }

  const [memberships, prefRows] = await Promise.all([
    db
      .select({
        company: companies,
        role: companyMemberships.role,
      })
      .from(companyMemberships)
      .innerJoin(companies, eq(companyMemberships.companyId, companies.id))
      .where(eq(companyMemberships.clerkUserId, userId))
      .orderBy(asc(companies.createdAt)),
    db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.clerkUserId, userId)),
  ]);

  let userCompanies = memberships.map((m) => m.company);
  let roleByCompany = new Map(memberships.map((m) => [m.company.id, m.role]));

  if (userCompanies.length === 0) {
    const created = await provisionDefaultCompanyForUser(userId, userName, userEmail);
    userCompanies = [created];
    roleByCompany = new Map([[created.id, "owner"]]);
  }

  const pref = prefRows[0];
  const activeCompany =
    userCompanies.find((c) => c.id === pref?.activeCompanyId) ?? userCompanies[0];

  if (!pref || pref.activeCompanyId !== activeCompany.id) {
    const now = new Date().toISOString();
    await db
      .insert(userPreferences)
      .values({
        clerkUserId: userId,
        activeCompanyId: activeCompany.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: userPreferences.clerkUserId,
        set: { activeCompanyId: activeCompany.id, updatedAt: now },
      });
  }

  return {
    clerkUserId: userId,
    userEmail,
    userName,
    activeCompany,
    companies: userCompanies,
    role: roleByCompany.get(activeCompany.id) ?? "owner",
  };
}

// React request-level deduplication: layout.tsx + page.tsx share 1 execution per request
export const getAuthContext = cache(computeAuthContext);

export async function switchActiveCompany(
  clerkUserId: string,
  companyId: string,
): Promise<boolean> {
  await ensureDatabaseReady();
  const [membership] = await db
    .select()
    .from(companyMemberships)
    .where(
      and(
        eq(companyMemberships.clerkUserId, clerkUserId),
        eq(companyMemberships.companyId, companyId),
      ),
    );
  if (!membership) return false;

  const now = new Date().toISOString();
  await db
    .insert(userPreferences)
    .values({
      clerkUserId,
      activeCompanyId: companyId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userPreferences.clerkUserId,
      set: { activeCompanyId: companyId, updatedAt: now },
    });
  return true;
}
