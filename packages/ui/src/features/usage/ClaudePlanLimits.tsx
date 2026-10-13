import {
  type AccountUsage,
  type AccountUsageWindow,
  CLAUDE_WEEKLY_OPUS_LIMIT_ID,
  CLAUDE_WEEKLY_SONNET_LIMIT_ID,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Progress,
  SettingsSection,
} from "@openbot/ui";
import { createSignal, For, onSettled, Show } from "solid-js";
import { type TextValue, useText } from "../../text";

/** The Claude plan windows the panel shows. A window Claude did not report is null or absent. */
interface ClaudePlanLimitsData {
  fiveHour: AccountUsageWindow | null;
  weekly: AccountUsageWindow | null;
  weeklyOpus?: AccountUsageWindow | null;
  weeklySonnet?: AccountUsageWindow | null;
}

const ROWS = [
  { key: "fiveHour", label: "usage.limits.fiveHour" },
  { key: "weekly", label: "usage.limits.weekly" },
  { key: "weeklyOpus", label: "usage.limits.weeklyOpus" },
  { key: "weeklySonnet", label: "usage.limits.weeklySonnet" },
] as const satisfies ReadonlyArray<{ key: keyof ClaudePlanLimitsData; label: AppTextKey }>;

const FIVE_HOUR_MINS = 300;
const WEEK_MINS = 10_080;
const MINUTE_MS = 60_000;

function near(durationMins: number | null, targetMins: number): boolean {
  return durationMins !== null && Math.abs(durationMins - targetMins) <= targetMins * 0.05;
}

/**
 * The Claude rows of the account usage. Claude reports its 5-hour window as `primary` and its
 * weekly window as `secondary`; the duration decides which is which, so a reading with only one
 * window still lands in the correct row. The weekly window of a model family comes as its own
 * limit; a host that does not send it leaves that row out. Null means Claude reported no plan
 * limits, which is the case for an API key account.
 */
export function claudePlanLimits(usage: AccountUsage | null): ClaudePlanLimitsData | null {
  const limit = usage?.limits.find((item) => item.id === "claude");
  if (!limit) return null;
  const data: ClaudePlanLimitsData = { fiveHour: null, weekly: null };
  for (const reading of [limit.primary, limit.secondary]) {
    if (!reading) continue;
    if (near(reading.windowDurationMins, FIVE_HOUR_MINS)) data.fiveHour = reading;
    else if (near(reading.windowDurationMins, WEEK_MINS)) data.weekly = reading;
  }
  const familyWeekly = (id: string) => usage?.limits.find((item) => item.id === id)?.secondary ?? null;
  data.weeklyOpus = familyWeekly(CLAUDE_WEEKLY_OPUS_LIMIT_ID);
  data.weeklySonnet = familyWeekly(CLAUDE_WEEKLY_SONNET_LIMIT_ID);
  return data.fiveHour || data.weekly || data.weeklyOpus || data.weeklySonnet ? data : null;
}

/** "Resets in …" from an epoch-seconds reset time, relative to `now` in milliseconds. */
function claudeResetLabel(resetsAt: number | null, now: number, text: Pick<TextValue, "t">): string {
  const { t } = text;
  if (resetsAt === null) return t("usage.limits.resetUnknown");
  const minutesLeft = Math.ceil((resetsAt * 1_000 - now) / MINUTE_MS);
  if (minutesLeft <= 0) return t("usage.limits.resetsNow");
  if (minutesLeft < 60) return t("usage.limits.resetsInMinutes", { minutes: minutesLeft });
  const hoursLeft = Math.floor(minutesLeft / 60);
  if (hoursLeft < 24) return t("usage.limits.resetsInHours", { hours: hoursLeft, minutes: minutesLeft % 60 });
  return t("usage.limits.resetsInDays", { days: Math.floor(hoursLeft / 24), hours: hoursLeft % 24 });
}

/**
 * The Claude plan limits at the top of the usage report: one bar per window with the percent used
 * and the time to its reset. The reset text counts down once a minute while the panel is open.
 */
export function ClaudePlanLimits(props: {
  limits: ClaudePlanLimitsData | null;
  loading: boolean;
  /** Milliseconds since the epoch. Stories fix it; the default is the clock. */
  now?: number;
}) {
  const text = useText();
  const { t, format } = text;
  const [clock, setClock] = createSignal(Date.now());
  onSettled(() => {
    const timer = setInterval(() => setClock(Date.now()), MINUTE_MS);
    return () => clearInterval(timer);
  });
  const now = () => props.now ?? clock();
  const rows = () => {
    const limits = props.limits;
    if (!limits) return [];
    return ROWS.flatMap((row) => {
      const reading = limits[row.key];
      return reading ? [{ label: t(row.label), reading }] : [];
    });
  };
  // The section and the card are the ones of a Settings tab, so the limits read as the same kind
  // of surface as every other account setting.
  return (
    <SettingsSection class="claude-plan-limits" title={t("usage.limits.title")}>
      <ItemGroup class="settings-modal-card">
        <Show
          when={rows().length > 0}
          fallback={
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemDescription role="status">
                  {props.loading ? t("usage.limits.loading") : t("usage.limits.unavailable")}
                </ItemDescription>
              </ItemContent>
            </Item>
          }
        >
          <For each={rows()}>
            {(row) => {
              const used = () => format.percent(row.reading.usedPercent / 100, { maximumFractionDigits: 0 });
              return (
                <Item class="settings-modal-row" data-usage-high={row.reading.usedPercent >= 90 ? "" : undefined}>
                  <ItemContent>
                    <ItemTitle>{row.label}</ItemTitle>
                    <Progress
                      value={row.reading.usedPercent}
                      minValue={0}
                      maxValue={100}
                      aria-label={t("usage.limits.meter", { name: row.label })}
                      getValueLabel={() => t("usage.limits.used", { percent: used() })}
                    />
                    <ItemDescription>{claudeResetLabel(row.reading.resetsAt, now(), text)}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ItemDescription>{t("usage.limits.used", { percent: used() })}</ItemDescription>
                  </ItemActions>
                </Item>
              );
            }}
          </For>
        </Show>
      </ItemGroup>
    </SettingsSection>
  );
}
