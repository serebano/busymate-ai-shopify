import { useEffect, useRef, useState } from "react";
import { useRevalidator } from "react-router";
import { startActivationRecheck } from "./activationRecheck";

/**
 * While `activating`, re-run the route's loaders by themselves (see
 * `startActivationRecheck`) and return `slow` once the hold has lasted past the
 * 5-minute fast phase.
 *
 * The effect depends on `activating` ONLY. The revalidator object changes
 * identity on every re-check (react-router 7), so it is read through a ref:
 * listing it as a dependency restarted the loop at tick 0 every 5 s and the
 * "taking longer" banner with Retry setup never rendered (#3718, re-review
 * defect 2). `test/activationRecheck.test.ts` drives this hook in a real data
 * router.
 */
export function useActivationRecheck(activating: boolean): boolean {
  const revalidator = useRevalidator();
  const latest = useRef(revalidator);
  latest.current = revalidator;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!activating) {
      setSlow(false);
      return undefined;
    }
    return startActivationRecheck({ revalidator: () => latest.current, onSlow: setSlow });
  }, [activating]);
  return slow;
}
