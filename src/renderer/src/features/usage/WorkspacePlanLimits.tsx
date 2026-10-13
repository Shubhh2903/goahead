import { ClaudePlanLimits, claudePlanLimits } from "@openbot/ui/features/usage/ClaudePlanLimits";
import { createEffect, createStore, untrack } from "solid-js";
import { useAuth } from "../account/account-context";
import { useAccountUsageTarget } from "../account/account-usage-target";

/**
 * The Claude plan limits of the account, above the desktop usage report. They come from the same
 * account usage reading as the dock. When no reading is loaded yet, this asks for one once per
 * reading target, through the refresh the dock uses.
 */
export function WorkspacePlanLimits() {
  const auth = useAuth();
  const { ready, targetKey } = useAccountUsageTarget();
  const [request, setRequest] = createStore<{ targetKey: string | null; failed: boolean }>({
    targetKey: null,
    failed: false,
  });
  createEffect(
    () => [ready(), targetKey(), auth.accountUsage() === null] as const,
    ([isReady, key, missing]) => {
      if (!isReady || !key || !missing || untrack(() => request.targetKey) === key) return;
      setRequest((draft) => {
        draft.targetKey = key;
        draft.failed = false;
      });
      void auth.refreshAccountUsage(key).catch(() => {
        setRequest((draft) => {
          if (draft.targetKey === key) draft.failed = true;
        });
      });
    },
  );
  return (
    <ClaudePlanLimits
      limits={claudePlanLimits(auth.accountUsage())}
      loading={auth.accountUsage() === null && ready() && !request.failed}
    />
  );
}
