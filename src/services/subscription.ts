const SFS_URL = process.env["SFS_INTERNAL_URL"] ?? "";
const SFS_SECRET = process.env["SFS_INTERNAL_SECRET"] ?? "";

export async function verifySubscription(pubkey: string): Promise<boolean> {
  if (!SFS_URL || !SFS_SECRET) {
    return false;
  }
  const url = `${SFS_URL.replace(/\/$/, "")}/internal/subscription-status?pubkey=${encodeURIComponent(pubkey)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-internal-secret": SFS_SECRET,
      },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { active?: boolean };
    return data.active === true;
  } catch {
    return false;
  }
}
