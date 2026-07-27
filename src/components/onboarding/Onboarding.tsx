import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Gamepad2,
  Library,
  Sparkles,
  Trophy
} from "lucide-react";

type OnboardingProps = {
  onComplete: (destination?: "steam-settings") => Promise<void>;
};

const steps = [
  {
    eyebrow: "WELCOME",
    icon: Sparkles,
    title: "Your achievements, in one place",
    description:
      "Achievement Nexus gives your gaming history a calm, focused home—built around the progress that matters to you."
  },
  {
    eyebrow: "TRACK YOUR JOURNEY",
    icon: Trophy,
    title: "See every milestone clearly",
    description:
      "Follow your games, unlocked achievements, completion progress, rare finds, and recent activity from one desktop dashboard."
  },
  {
    eyebrow: "OPTIONAL CONNECTION",
    icon: Gamepad2,
    title: "Bring in your Steam library",
    description:
      "Use the existing Steam Account settings to connect when you are ready. You can safely skip this step and return later."
  },
  {
    eyebrow: "READY",
    icon: Check,
    title: "Your nexus is ready",
    description:
      "Start exploring your library and achievements. You can replay this introduction at any time from Settings."
  }
] as const;

export function Onboarding({ onComplete }: OnboardingProps) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [openSteamAfterFinish, setOpenSteamAfterFinish] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const current = steps[step];
  const Icon = current.icon;

  useEffect(() => {
    primaryActionRef.current?.focus();
  }, [step]);

  const finish = async () => {
    setSubmitting(true);
    setError("");
    try {
      await onComplete(openSteamAfterFinish ? "steam-settings" : undefined);
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "Unable to save onboarding progress.");
      setSubmitting(false);
    }
  };

  const next = () => setStep((value) => Math.min(value + 1, steps.length - 1));
  const back = () => setStep((value) => Math.max(value - 1, 0));

  return (
    <main className="onboarding-shell">
      <section className="onboarding-card" aria-labelledby="onboarding-title">
        <div className="onboarding-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
          {steps.map((item, index) => (
            <span key={item.eyebrow} className={index <= step ? "active" : ""} aria-hidden="true" />
          ))}
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            className="onboarding-step"
            key={current.eyebrow}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
          >
            <div className="onboarding-icon" aria-hidden="true"><Icon size={30} /></div>
            <p className="onboarding-eyebrow">{current.eyebrow}</p>
            <h1 id="onboarding-title">{current.title}</h1>
            <p className="onboarding-description">{current.description}</p>

            {step === 1 && (
              <div className="onboarding-features" aria-label="Tracking features">
                <span><Library size={17} />Game library</span>
                <span><Trophy size={17} />Achievement progress</span>
              </div>
            )}

            {error && <p className="onboarding-error" role="alert">{error}</p>}

            <div className="onboarding-actions">
              {step > 0 && step < steps.length - 1 && (
                <button type="button" className="onboarding-secondary" onClick={back}>
                  <ArrowLeft size={17} /> Back
                </button>
              )}
              {step < 2 && (
                <button ref={primaryActionRef} type="button" className="onboarding-primary" onClick={next}>
                  Continue <ArrowRight size={17} />
                </button>
              )}
              {step === 2 && (
                <>
                  <button
                    type="button"
                    className="onboarding-secondary"
                    onClick={() => { setOpenSteamAfterFinish(false); next(); }}
                  >
                    Skip for now
                  </button>
                  <button
                    ref={primaryActionRef}
                    type="button"
                    className="onboarding-primary"
                    onClick={() => { setOpenSteamAfterFinish(true); next(); }}
                  >
                    Connect Steam <ArrowRight size={17} />
                  </button>
                </>
              )}
              {step === steps.length - 1 && (
                <button
                  ref={primaryActionRef}
                  type="button"
                  className="onboarding-primary"
                  onClick={() => void finish()}
                  disabled={submitting}
                >
                  {submitting ? "Saving..." : "Start using Achievement Nexus"}
                  {!submitting && <ArrowRight size={17} />}
                </button>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </section>
    </main>
  );
}
