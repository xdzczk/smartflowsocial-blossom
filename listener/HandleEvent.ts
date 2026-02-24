import HandleZapReceipt from "./HandleZapReceipt.js";
import type { AppInstance } from "../types.js";
import type { Event } from "nostr-tools";

export default async function HandleEvent(
  app: AppInstance,
  event: Event
): Promise<void> {
  try {
    switch (event.kind) {
      case 9735:
        await HandleZapReceipt(app, event);
        break;
      default:
        break;
    }
  } catch (err) {
    console.log(err);
  }
}
