import { Response } from "express";
import { getPublicKey, getEventHash, getSignature } from "nostr-tools";
import type { AppRequest } from "../types.js";
import type { ApiError } from "../types.js";

export default async function GetCredit(
  req: AppRequest,
  res: Response
): Promise<void> {
  try {
    if (req.blossom?.verb !== "credit") {
      throw { code: 401, message: "Expected t tag value 'credit'" } as ApiError;
    }

    let gb_months: number | undefined;

    for (const tag of req.blossom!.auth.tags) {
      if (tag[0] === "gb_months") {
        gb_months = parseFloat(tag[1]);
        if (isNaN(gb_months) || !isFinite(gb_months)) {
          throw { code: 400, message: "Invalid 'gb_months' tag" } as ApiError;
        }
        break;
      }
    }

    if (!gb_months) {
      throw { code: 400, message: "Missing 'gb_months' tag" } as ApiError;
    }

    const xr = await req.app.exchange!.getRateUSD();
    const amount =
      Math.round(
        xr * gb_months * parseFloat(process.env.STORAGE_RATE_USD ?? "0")
      ) * 1000;
    const content = `PURCHASE OF CDN STORAGE (${gb_months} GB MONTHS)`;
    const created_at = Math.floor(Date.now() / 1000);

    const offer: {
      content: string;
      created_at: number;
      pubkey: string;
      kind: number;
      tags: string[][];
      id?: string;
      sig?: string;
    } = {
      content,
      created_at,
      pubkey: getPublicKey(process.env.APP_SECRET_KEY ?? ""),
      kind: 9733,
      tags: [
        ["amount", String(amount)],
        ["gb_months", String(gb_months)],
        ["product", "cdn"],
      ],
    };

    offer.id = getEventHash(offer as Parameters<typeof getEventHash>[0]);
    offer.sig = getSignature(
      offer as Parameters<typeof getSignature>[0],
      process.env.APP_SECRET_KEY ?? ""
    );

    const payment = {
      content,
      created_at,
      pubkey: req.blossom!.auth.pubkey,
      kind: 9734,
      tags: [
        ["relays", ...(process.env.LISTENER_RELAYS ?? "").split(",")],
        ["amount", String(amount)],
        ["p", offer.pubkey],
        ["e", offer.id!],
      ],
    };

    req.app.db.createCredit({
      id: offer.id!,
      pubkey: req.blossom!.auth.pubkey,
      rate_usd: parseFloat(process.env.STORAGE_RATE_USD ?? "0"),
      created: created_at,
      gb_months,
      amount,
      offer,
    });

    res.json({
      callback: process.env.LIGHTNING_CALLBACK_URL,
      rateFiat: { usd: parseFloat(process.env.STORAGE_RATE_USD ?? "0") },
      amount,
      offer,
      payment,
    });
  } catch (err) {
    const e = err as ApiError;
    console.log(err);
    res.status(e.code ?? 500).json({ message: e.message ?? "Unknown Error" });
  }
}
