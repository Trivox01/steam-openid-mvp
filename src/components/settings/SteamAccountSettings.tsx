import type { UserProfile } from "../../types";
import { SteamOpenIdAccountSettings } from "./SteamOpenIdAccountSettings";

export function SteamAccountSettings({
  onProfileChange: _onProfileChange
}: {
  onProfileChange?: (profile: UserProfile) => void;
}) {
  return <SteamOpenIdAccountSettings />;
}
