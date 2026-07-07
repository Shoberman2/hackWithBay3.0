import Link from "next/link";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";

export default function Start() {
  return (
    <main className="relative min-h-[100dvh] bg-canvas text-ink">
      <header className="absolute left-8 top-8">
        <Link href="/" className="text-sm font-semibold tracking-tight">
          Rivalry
        </Link>
      </header>
      <OnboardingFlow />
    </main>
  );
}
