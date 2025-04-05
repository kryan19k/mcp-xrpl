import { Client, Wallet } from "xrpl";
import { z } from "zod";
import { server } from "../../server/server.js";
import { getXrplClient } from "../../core/services/clients.js";
import { MAINNET_URL, TESTNET_URL } from "../../core/constants.js";
import { connectedWallet, isConnectedToTestnet } from "../../core/state.js";

// Register amm-info tool
server.tool(
    "amm-info",
    "Get information about an Automated Market Maker (AMM) on the XRP Ledger",
    {
        account: z.string().optional().describe("AMM account address"),
        asset1: z
            .object({
                currency: z
                    .string()
                    .describe("Currency code of the first asset"),
                issuer: z
                    .string()
                    .optional()
                    .describe(
                        "Issuer address of the first asset (not needed for XRP)"
                    ),
            })
            .describe("First asset in the AMM's pool"),
        asset2: z
            .object({
                currency: z
                    .string()
                    .describe("Currency code of the second asset"),
                issuer: z
                    .string()
                    .optional()
                    .describe(
                        "Issuer address of the second asset (not needed for XRP)"
                    ),
            })
            .describe("Second asset in the AMM's pool"),
        useTestnet: z
            .boolean()
            .optional()
            .describe(
                "Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."
            ),
    },
    async ({ account, asset1, asset2, useTestnet }) => {
        let client: Client | null = null;
        try {
            // Determine which network to use
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Format assets for the request
            const formatAsset = (asset: {
                currency: string;
                issuer?: string;
            }) => {
                if (asset.currency === "XRP") {
                    return { currency: "XRP" };
                } else {
                    return {
                        currency: asset.currency,
                        issuer: asset.issuer,
                    };
                }
            };

            // Create amm_info request
            const ammInfoRequest: any = {
                command: "amm_info",
                asset: formatAsset(asset1),
                asset2: formatAsset(asset2),
            };

            // Add optional account if provided
            if (account) {
                ammInfoRequest.account = account;
            }

            // Submit request
            const result = await client.request(ammInfoRequest);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                network: useTestnetNetwork
                                    ? TESTNET_URL
                                    : MAINNET_URL,
                                networkType: useTestnetNetwork
                                    ? "testnet"
                                    : "mainnet",
                                result: result.result,
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
                        text: `Error getting AMM info: ${
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
