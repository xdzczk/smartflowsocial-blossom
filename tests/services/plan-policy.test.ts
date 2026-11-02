import { describe, expect, it } from "vitest";

import {
  getHostedMediaPolicy,
  mapLegacyRateClassToCommercialPlanType,
} from "../../src/planPolicy.js";

describe("plan policy mapping", () => {
  it("maps starter rate class to starter commercial plan", () => {
    expect(mapLegacyRateClassToCommercialPlanType("starter")).toBe("starter");
  });

  it("keeps basic mapped to creator for legacy compatibility", () => {
    expect(mapLegacyRateClassToCommercialPlanType("basic")).toBe("creator");
  });
});

describe("starter hosted media policy", () => {
  it("enables starter hosted storage with starter caps", () => {
    const starterPolicy = getHostedMediaPolicy("starter");
    expect(starterPolicy.canUseSfsBlossomStorage).toBe(true);
    expect(starterPolicy.monthlyStorageBytes).toBe(
      BigInt(5 * 1024 * 1024 * 1024)
    );
    expect(starterPolicy.monthlyUploadBytes).toBe(
      BigInt(20 * 1024 * 1024 * 1024)
    );
    expect(starterPolicy.maxFileBytes).toBe(50 * 1024 * 1024);
  });
});
