import release from "../../../release/version.json";

export const releaseNotes = {
  "0.1.0-beta.1": {
    en: { title: "Achievement Nexus Beta", summary: "A focused first Beta for your Steam library, achievements, and Nexus Tools.", items: ["Smarter library updates", "Safer game actions", "Nexus Tools foundation"] },
    ar: { title: "الإصدار التجريبي من Achievement Nexus", summary: "نسخة تجريبية أولى تركز على مكتبة Steam والإنجازات وأدوات Nexus.", items: ["تحديثات أذكى للمكتبة", "إجراءات ألعاب أكثر أمانًا", "الأساس الأول لأدوات Nexus"] }
  },
  "0.1.0-beta.2": {
    en: { title: "Achievement Nexus Beta 2", summary: "A signed delivery update that validates the new Nexus Beta channel while keeping installation in your control.", items: ["Signed updates through the Nexus Beta channel", "Clearer update delivery checks", "Safer release verification"] },
    ar: { title: "Achievement Nexus Beta 2", summary: "تحديث موقّع لاختبار قناة Nexus التجريبية الجديدة مع إبقاء قرار التثبيت بيدك.", items: ["تحديثات موقّعة عبر قناة Nexus التجريبية", "تحقق أوضح من وصول التحديث", "فحص أكثر أمانًا للإصدار"] }
  }
} as const;

export const currentReleaseVersion = release.version as keyof typeof releaseNotes;
export function hasSeenRelease(version = currentReleaseVersion) { return localStorage.getItem("nexus:last-seen-version") === version; }
export function markReleaseSeen(version = currentReleaseVersion) { localStorage.setItem("nexus:last-seen-version", version); }
