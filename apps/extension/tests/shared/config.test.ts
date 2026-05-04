import { describe, expect, it } from "vitest";

import { API_BASE_URL } from "../../src/shared/config";

describe("extension shared config", () => {
  it("normalizes the API base url without trailing slashes", () => {
    expect(API_BASE_URL).toBe("http://127.0.0.1:8000");
  });
});
