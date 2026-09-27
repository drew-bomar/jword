import { ATS_PROVIDER_LABELS } from "../domain/enums";
import type { SupportedBoardProvider } from "../watchlist/boards";

/** The application `source` for a lead's provider; mirrors jword.provider_label(). */
export function providerLabel(provider: SupportedBoardProvider): string {
  return ATS_PROVIDER_LABELS[provider];
}
