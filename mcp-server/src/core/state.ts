import { Wallet } from "xrpl";

// State to store connected wallet
export let connectedWallet: Wallet | null = null;
export let isConnectedToTestnet = false;

export function setConnectedWallet(
    wallet: Wallet | null,
    isTestnet: boolean
): void {
    connectedWallet = wallet;
    isConnectedToTestnet = isTestnet;
}
