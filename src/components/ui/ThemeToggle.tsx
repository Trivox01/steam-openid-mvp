import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../state/ThemeContext";
import { useTranslation } from "../../i18n/TranslationContext";

export function ThemeToggle() {
  const { resolvedTheme, toggleTheme } = useTheme();
  const { t } = useTranslation();
  return (
    <button className="icon-button" onClick={toggleTheme} aria-label={t("theme.switch", { theme: t(`theme.${resolvedTheme === "dark" ? "light" : "dark"}`) })}>
      {resolvedTheme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
