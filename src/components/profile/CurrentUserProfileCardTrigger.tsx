import type { ReactNode } from "react";
import type { UserProfile } from "../../types";
import { services } from "../../services/compositionRoot";
import { createCurrentUserProfileSummary } from "../../features/profile/profileSummaryAdapter";
import { useTranslation } from "../../i18n/TranslationContext";
import { ProfileCardTrigger } from "./ProfileCardTrigger";

export function CurrentUserProfileCardTrigger({
  profile,
  children,
  onAction
}: {
  profile?: UserProfile;
  children: ReactNode;
  onAction?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ProfileCardTrigger
      onAction={onAction}
      loadSummary={async () => {
        const identity = await services.steamOpenId?.getSavedIdentity();
        if (!identity) return undefined;
        const { games, achievements } = await services.statistics.get();
        return createCurrentUserProfileSummary({ profile, identity, games, achievements, translate: t });
      }}
    >
      {children}
    </ProfileCardTrigger>
  );
}
