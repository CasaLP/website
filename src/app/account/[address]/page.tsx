import { notFound } from "next/navigation";
import Link from "next/link";
import { WalletView } from "@/components/wallet/WalletView";

type Props = { params: Promise<{ address: string }> };

export default async function WalletPage({ params }: Props) {
  const { address } = await params;
  if (!address) return notFound();

  return (
    <div className="mx-auto w-full max-w-6xl p-6 space-y-6">
      <WalletView address={address} />
      <footer className="text-xs text-muted-foreground"></footer>
    </div>
  );
}
