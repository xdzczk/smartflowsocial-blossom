/**
 * Central plan policy for SmartFlowSocial-hosted media enforcement.
 *
 * Intent (must stay aligned with SmartFlowSocial app policy):
 * - Free is intentionally excluded from SFS-hosted storage.
 * - Starter is the first hosted-media tier.
 * - Pro is the operator-grade hosted-media tier.
 * - Founder inherits Pro limits for now.
 * - Teams is intentionally not publicly specified yet; internal behavior is explicit.
 */

export type CommercialPlanType =
  "free" | "starter" | "creator" | "pro" | "teams" | "founder";

export interface HostedMediaPolicy {
  canUseSfsBlossomStorage: boolean;
  monthlyStorageBytes: bigint | null;
  monthlyUploadBytes: bigint | null;
  maxFileBytes: number | null;
  maxParallelUploadsHint: number | null;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

const POLICIES: Record<CommercialPlanType, HostedMediaPolicy> = {
  free: {
    canUseSfsBlossomStorage: false,
    monthlyStorageBytes: null,
    monthlyUploadBytes: null,
    maxFileBytes: null,
    maxParallelUploadsHint: null,
  },
  starter: {
    canUseSfsBlossomStorage: true,
    monthlyStorageBytes: BigInt(5 * GB),
    monthlyUploadBytes: BigInt(20 * GB),
    maxFileBytes: 50 * MB,
    maxParallelUploadsHint: 4,
  },
  creator: {
    canUseSfsBlossomStorage: true,
    monthlyStorageBytes: BigInt(10 * GB),
    monthlyUploadBytes: BigInt(40 * GB),
    maxFileBytes: 100 * MB,
    maxParallelUploadsHint: 6,
  },
  pro: {
    canUseSfsBlossomStorage: true,
    monthlyStorageBytes: BigInt(50 * GB),
    monthlyUploadBytes: BigInt(250 * GB),
    maxFileBytes: 250 * MB,
    maxParallelUploadsHint: 8,
  },
  founder: {
    // Founder inherits Pro hosted media limits exactly.
    canUseSfsBlossomStorage: true,
    monthlyStorageBytes: BigInt(50 * GB),
    monthlyUploadBytes: BigInt(250 * GB),
    maxFileBytes: 250 * MB,
    maxParallelUploadsHint: 8,
  },
  teams: {
    // Internal-only for now: treat Teams as Pro-equivalent hosted media.
    // IMPORTANT: Do not expose speculative Teams hosted-media limits publicly.
    canUseSfsBlossomStorage: true,
    monthlyStorageBytes: BigInt(50 * GB),
    monthlyUploadBytes: BigInt(250 * GB),
    maxFileBytes: 250 * MB,
    maxParallelUploadsHint: 8,
  },
};

export function getHostedMediaPolicy(
  planType: CommercialPlanType
): HostedMediaPolicy {
  return POLICIES[planType];
}

export function mapLegacyRateClassToCommercialPlanType(
  rateClass: string | undefined
): CommercialPlanType {
  const raw = (rateClass ?? "").trim().toLowerCase();
  switch (raw) {
    case "free":
      return "free";
    case "starter":
      return "starter";
    case "basic":
      return "creator";
    case "creator":
      return "creator";
    case "premium":
      return "pro";
    case "pro":
      return "pro";
    case "enterprise":
      // Legacy placeholder.
      return "pro";
    case "founder":
      return "founder";
    case "teams":
      return "teams";
    default:
      return "free";
  }
}
