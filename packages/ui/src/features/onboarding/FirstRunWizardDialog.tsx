import { Button, Dialog } from "@openbot/ui";
import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import { useText } from "../../text";

export interface FirstRunWizardDialogProps {
  open: boolean;
  /** One-based place of this step in the whole wizard, for the progress label. */
  stepNumber: number;
  stepCount: number;
  title: string;
  description: string;
  /** The step's own content: an existing panel, unchanged. */
  children: JSX.Element;
  /** The last step says "Finish" instead of "Next". */
  last: boolean;
  /** Absent on the first step this dialog shows. */
  onBack?: (() => void) | undefined;
  onNext: () => void;
  onSkipStep: () => void;
  /** Ends the wizard for good. A close of the dialog is the same choice. */
  onSkipAll: () => void;
}

/**
 * The steps of first-run setup that come after the first agent: one dialog, the step's content in
 * the middle, and the same actions on each step. Every step can be skipped, and so can the rest.
 */
export function FirstRunWizardDialog(props: FirstRunWizardDialogProps) {
  const { t } = useText();
  return (
    <Dialog.Root
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onSkipAll();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay class="first-run-wizard-backdrop">
          <Dialog.Content class="first-run-wizard" as="section">
            <header class="first-run-wizard-header">
              <p class="first-run-wizard-progress">
                {t("onboarding.wizard.progress", { step: props.stepNumber, total: props.stepCount })}
              </p>
              <Dialog.Title class="first-run-wizard-title">{props.title}</Dialog.Title>
              <Dialog.Description class="first-run-wizard-description">{props.description}</Dialog.Description>
            </header>

            <div class="first-run-wizard-body">{props.children}</div>

            <footer class="first-run-wizard-actions">
              <Button type="button" variant="ghost" onClick={() => props.onSkipAll()}>
                {t("onboarding.wizard.skipAll")}
              </Button>
              <div class="first-run-wizard-step-actions">
                <Show when={props.onBack}>
                  {(back) => (
                    <Button type="button" variant="outline" onClick={() => back()()}>
                      {t("common.back")}
                    </Button>
                  )}
                </Show>
                <Button type="button" variant="outline" onClick={() => props.onSkipStep()}>
                  {t("onboarding.wizard.skipStep")}
                </Button>
                <Button type="button" variant="default" onClick={() => props.onNext()}>
                  {props.last ? t("onboarding.wizard.finish") : t("onboarding.action.next")}
                </Button>
              </div>
            </footer>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
