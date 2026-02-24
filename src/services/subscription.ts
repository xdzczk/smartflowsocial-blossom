import { loadConfig } from "../config.js";

export async function verifySubscription(pubkey: string): Promise<boolean> {
  const { sfs } = loadConfig();
  if (!sfs.internalUrl || !sfs.internalSecret) {
    return false;
  }
  const url = `${sfs.internalUrl.replace(/\/$/, "")}/internal/subscription-status?pubkey=${encodeURIComponent(pubkey)}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "x-internal-secret": sfs.internalSecret,
      },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { active?: boolean };
    return data.active === true;
  } catch {
    return false;
  }
}
