import { verifySignature } from "nostr-tools";
import type { AppInstance } from "../types.js";
import type { Event } from "nostr-tools";

export default async function HandleZapReceipt(
  app: AppInstance,
  event: Event
): Promise<void> {
  let amount: number | undefined;
  let offerId: string | undefined;
  let offerTargetPubkey: string | undefined;
  let zapRequest: Event | undefined;

  if (event.pubkey !== process.env.LIGHTNING_PROVIDER_PUBKEY) {
    console.log("Received zap receipt signed by unknown pubkey", event);
    return;
  }

  for (const tag of event.tags) {
    if (tag[0] === "description") {
      zapRequest = JSON.parse(tag[1]) as Event;
      break;
    }
  }

  if (!zapRequest) {
    console.log("Failed to parse zap request", event);
    return;
  }

  if (!verifySignature(zapRequest)) {
    console.log("Failed to verify zap request signature", event);
    return;
  }

  for (const tag of zapRequest.tags) {
    if (tag[0] === "amount") {
      amount = parseInt(tag[1], 10);
      if (isNaN(amount) || !isFinite(amount)) {
        console.log("Invalid amount on zap request", event);
        return;
      }
    } else if (tag[0] === "e") {
      offerId = tag[1];
    } else if (tag[0] === "p") {
      offerTargetPubkey = tag[1];
    }
  }

  if (!amount) {
    console.log("Failed to parse zapRequest amount", event);
  }

  if (!offerTargetPubkey) {
    console.log("Failed to parse zap request offer id", event);
    return;
  }

  if (offerTargetPubkey !== app.pubkey) {
    console.log("Zap request target public key does not match expected", event);
    return;
  }

  app.db.handlePayment({
    paid_at: event.created_at,
    paid_by: zapRequest.pubkey,
    receipt: JSON.stringify(event),
    id: offerId!,
  });
}
