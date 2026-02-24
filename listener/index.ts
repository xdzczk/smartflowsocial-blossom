import { relayInit } from "nostr-tools";
import type { Event } from "nostr-tools";
import type { AppInstance } from "../types.js";

interface RelayLike {
  url: string;
  connect(): Promise<void>;
  sub(
    filters: object[],
    options?: object
  ): {
    on(event: string, cb: (...args: unknown[]) => void): void;
    sub(filters: object[], options?: object): void;
  };
  on(event: string, cb: () => void): void;
  _reconnectTimeout?: ReturnType<typeof setTimeout>;
  _encounteredError?: boolean;
  _reconnectMillsecs?: number;
  _pendingReconnect?: boolean;
}

interface PoolEntry {
  connection: Record<
    string,
    {
      req: {
        sub: (filters: object[], options?: object) => void;
        on: (event: string, cb: (...args: unknown[]) => void) => void;
      };
    } | null
  >;
  filters: object[];
  options: object;
}

type EventHandler = (app: AppInstance, event: Event, relayUrl: string) => void;

export default class Listener {
  app: AppInstance;
  relays: RelayLike[] = [];
  pool: Record<string, PoolEntry> = {};
  seen: Record<string, boolean> = {};
  handlers: Record<string, EventHandler> = {};

  constructor(app: AppInstance) {
    this.app = app;
  }

  async connect(url: string): Promise<void> {
    for (const connected of this.relays) {
      if (connected.url === url) {
        return;
      }
    }

    let relay: RelayLike | undefined;

    try {
      relay = relayInit(url) as unknown as RelayLike;
    } catch (err) {
      console.log(err);
      return;
    }

    if (!relay) return;

    relay.on("connect", () => {
      clearTimeout(relay!._reconnectTimeout);

      relay!._encounteredError = false;
      relay!._reconnectMillsecs = 500;

      Object.keys(this.pool).forEach((name) => {
        const { connection } = this.pool[name];
        if (!connection[relay!.url]) {
          this.subscribe(name, relay!);
          console.log("[LISTENING] " + relay!.url);
        }
      });
    });

    relay.on("error", () => {
      Object.keys(this.pool).forEach((name) => {
        const { connection } = this.pool[name];
        connection[relay!.url] = null;
      });

      console.log(`[UNREACHABLE] ${relay!.url}`);
      relay!._encounteredError = true;

      if (relay!._pendingReconnect) {
        return;
      }

      if (!relay!._reconnectMillsecs) {
        relay!._reconnectMillsecs = 500;
      }

      relay!._reconnectMillsecs = relay!._reconnectMillsecs! * 2;
      clearTimeout(relay!._reconnectTimeout);
      relay!._pendingReconnect = true;

      relay!._reconnectTimeout = setTimeout(async () => {
        relay!._pendingReconnect = false;
        try {
          await relay!.connect();
        } catch {
          // ignore
        }
        relay!._pendingReconnect = false;
      }, relay!._reconnectMillsecs);

      console.log(
        relay!.url +
          " reconnecting after " +
          relay!._reconnectMillsecs +
          " ms..."
      );
    });

    relay.on("disconnect", async () => {
      if (!relay!._encounteredError) {
        Object.keys(this.pool).forEach((name) => {
          const { connection } = this.pool[name];
          connection[relay!.url] = null;
        });
        try {
          console.log("[DISCONNECTED] " + relay!.url + " (reconnecting)");
          await relay!.connect();
        } catch {
          // ignore
        }
      }
    });

    try {
      await relay.connect();
    } catch (err) {
      console.log(err);
      return;
    }

    this.relays.push(relay);
  }

  createPool(name: string, filters: object[] = [], options: object = {}): void {
    if (!this.pool[name]) {
      this.pool[name] = {
        connection: {},
        filters,
        options,
      };
    }

    for (const connected of this.relays) {
      this.subscribe(name, connected);
    }
  }

  subscribe(name: string, relay: RelayLike): void {
    const pool = this.pool[name];
    if (!pool) return;

    if (pool.connection[relay.url]) {
      pool.connection[relay.url]!.req.sub(pool.filters, pool.options);
    } else {
      const req = relay.sub(pool.filters, pool.options);
      req.on("event", (event: unknown) => {
        this.handlers["event"](this.app, event as Event, relay.url);
      });
      pool.connection[relay.url] = { req };
    }
  }

  on(name: string, handler: EventHandler): void {
    this.handlers[name] = handler;
  }
}
