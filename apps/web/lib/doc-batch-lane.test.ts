import { describe, expect, it } from "vitest";
import { laneFor, SMALL_JOB_UNITS } from "./doc-batch-lane";

describe("帳票の仕事の車線", () => {
  it("1 件ものと少ない枚数は小さい車線", () => {
    expect(laneFor(1)).toBe("small");
    expect(laneFor(SMALL_JOB_UNITS)).toBe("small");
  });
  it("上限を超えたら大きい車線", () => {
    expect(laneFor(SMALL_JOB_UNITS + 1)).toBe("large");
    expect(laneFor(500)).toBe("large");
  });
});
