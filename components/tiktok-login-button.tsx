// components/TikTokLoginButton.tsx
import Image from "next/image";

export default function TikTokLoginButton() {
  return (
    <a
      href="/api/tiktok/login"
      className="inline-flex items-center gap-2 rounded-md bg-black px-4 py-2 text-white hover:opacity-90 transition"
    >
      <Image src="/tiktok-logo.png" alt="TikTok" width={20} height={20} />
      Continue With TikTok
    </a>
  );
}
