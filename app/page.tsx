import OnboardingFlow from "@/components/onboarding/OnboardingFlow";

export default function Home() {
  return (
    <main className="relative min-h-[100dvh] bg-canvas text-ink">
      <header className="absolute left-8 top-8">
        <span className="text-sm font-semibold tracking-tight">Rivalry</span>
      </header>
      <OnboardingFlow />
    </main>
  );
}
