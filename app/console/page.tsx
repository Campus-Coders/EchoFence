import React from "react";
import type { Metadata } from "next";
import { VoiceConsole } from "@/components/voice/VoiceConsole";

export const metadata: Metadata = {
  title: "EchoFence Console — Voice Operations & Evidence",
  description: "Real-time voice console and generation fence evidence monitor.",
};

export default function ConsolePage(): React.JSX.Element {
  return <VoiceConsole />;
}
