import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/window";

export const messages = {
  "window.localHostTitle": "GoAhead Yerel Ana Makine",
  "window.localClientTitle": "GoAhead Yerel İstemci",
  "window.computerUsePermissionTitle": "Bilgisayar Kullanımını Aç",
} as const satisfies PartialTranslation<typeof source>;
