import { Client, Wallet } from "xrpl";
import { z } from "zod";
import { server } from "../server/server.js";
import { getXrplClient } from "../core/services/clients.js";
import { DEFAULT_SEED, MAINNET_URL, TESTNET_URL } from "../core/constants.js";
import {
    connectedWallet,
    isConnectedToTestnet,
    setConnectedWallet,
} from "../core/state.js";

// Register XRPL connection tool
server.tool(
    "connect-to-xrpl",
    "Connect to XRP Ledger using seed from .env or create a new wallet",
    {
        useSeedFromEnv: z
            .boolean()
            .optional()
            .describe(
                "Whether to use the seed from .env file (true) or create a new wallet (false). Defaults to true if a seed is configured."
            ),
    },
    async ({ useSeedFromEnv }) => {
        let client: Client | null = null;
        let isTestnet = false;
        let wallet;
        try {
            // Default to using env seed if available
            const useEnvSeed =
                useSeedFromEnv === undefined ? !!DEFAULT_SEED : useSeedFromEnv;

            if (useEnvSeed && DEFAULT_SEED) {
                // Use mainnet for existing wallets
                client = await getXrplClient(false);
                wallet = Wallet.fromSeed(DEFAULT_SEED);
                console.error("Using wallet from .env seed on mainnet");
            } else {
                // Use testnet for creating new wallets
                isTestnet = true;
                client = await getXrplClient(true);

                if (useEnvSeed && !DEFAULT_SEED) {
                    console.error(
                        "No seed found in .env, creating new wallet on testnet"
                    );
                }

                const fundResult = await client.fundWallet();
                wallet = fundResult.wallet;
            }

            // Store the connected wallet
            setConnectedWallet(wallet, isTestnet);

            const accountInfo = await client.request({
                command: "account_info",
                account: wallet.address,
                ledger_index: "validated",
            });

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                status: "connected",
                                network: isTestnet ? TESTNET_URL : MAINNET_URL,
                                networkType: isTestnet ? "testnet" : "mainnet",
                                wallet: {
                                    address: wallet.address,
                                    publicKey: wallet.publicKey,
                                    // Only return seed for newly created wallets
                                    seed:
                                        !useEnvSeed || !DEFAULT_SEED
                                            ? wallet.seed
                                            : undefined,
                                },
                                usingEnvSeed: useEnvSeed && !!DEFAULT_SEED,
                                balance:
                                    accountInfo.result.account_data.Balance,
                            },
                            null,
                            2
                        ),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error connecting to XRPL: ${
                            error instanceof Error
                                ? error.message
                                : String(error)
                        }`,
                    },
                ],
            };
        } finally {
            if (client) {
                await client.disconnect();
            }
        }
    }
);
