import { http, createConfig } from "wagmi";
import { arbitrum, base, scroll } from "wagmi/chains";

export const wagmiConfig = createConfig({
  chains: [arbitrum, base, scroll],
  transports: {
    [arbitrum.id]: http(),
    [base.id]: http(),
    [scroll.id]: http()
  },
  ssr: true
});
