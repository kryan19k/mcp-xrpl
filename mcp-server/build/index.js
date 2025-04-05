import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { Client, Wallet } from "xrpl";
import * as xrpl from "xrpl";
import dotenv from "dotenv";
// Load environment variables
dotenv.config();
// XRPL network URLs
const MAINNET_URL = "wss://xrplcluster.com";
const TESTNET_URL = "wss://s.altnet.rippletest.net:51233";
const DEFAULT_SEED = process.env.XRPL_SEED;
// State to store connected wallet
let connectedWallet = null;
let isConnectedToTestnet = false;
// Create server instance
const server = new McpServer({
    name: "xrpl-mcp-server",
    version: "1.0.0",
    capabilities: {
        resources: {},
        tools: {},
    },
});
// Helper function for XRPL client connection
async function getXrplClient(useTestnet = false) {
    const serverUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    const client = new Client(serverUrl);
    await client.connect();
    return client;
}
// Register XRPL connection tool
server.tool("connect-to-xrpl", "Connect to XRP Ledger using seed from .env or create a new wallet", {
    useSeedFromEnv: z
        .boolean()
        .optional()
        .describe("Whether to use the seed from .env file (true) or create a new wallet (false). Defaults to true if a seed is configured."),
}, async ({ useSeedFromEnv }) => {
    let client = null;
    let isTestnet = false;
    let wallet;
    try {
        // Default to using env seed if available
        const useEnvSeed = useSeedFromEnv === undefined ? !!DEFAULT_SEED : useSeedFromEnv;
        if (useEnvSeed && DEFAULT_SEED) {
            // Use mainnet for existing wallets
            client = await getXrplClient(false);
            wallet = Wallet.fromSeed(DEFAULT_SEED);
            console.error("Using wallet from .env seed on mainnet");
        }
        else {
            // Use testnet for creating new wallets
            isTestnet = true;
            client = await getXrplClient(true);
            if (useEnvSeed && !DEFAULT_SEED) {
                console.error("No seed found in .env, creating new wallet on testnet");
            }
            const fundResult = await client.fundWallet();
            wallet = fundResult.wallet;
        }
        // Store the connected wallet
        connectedWallet = wallet;
        isConnectedToTestnet = isTestnet;
        const accountInfo = await client.request({
            command: "account_info",
            account: wallet.address,
            ledger_index: "validated",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status: "connected",
                        network: isTestnet ? TESTNET_URL : MAINNET_URL,
                        networkType: isTestnet ? "testnet" : "mainnet",
                        wallet: {
                            address: wallet.address,
                            publicKey: wallet.publicKey,
                            // Only return seed for newly created wallets
                            seed: !useEnvSeed || !DEFAULT_SEED
                                ? wallet.seed
                                : undefined,
                        },
                        usingEnvSeed: useEnvSeed && !!DEFAULT_SEED,
                        balance: accountInfo.result.account_data.Balance,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error connecting to XRPL: ${error instanceof Error
                        ? error.message
                        : String(error)}`,
                },
            ],
        };
    }
    finally {
        if (client) {
            await client.disconnect();
        }
    }
});
// Register XRPL transfer tool
server.tool("transfer-xrp", "Transfer XRP between accounts using the connected wallet or a specified seed", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to send XRP from. If not provided, the connected wallet will be used."),
    toAddress: z
        .string()
        .describe("XRP Ledger account address to send XRP to (starts with r)"),
    amount: z.string().describe("Amount of XRP to send"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, toAddress, amount, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
        // If useTestnet is explicitly provided, use that
        // Otherwise, use the network from the connected wallet
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        client = await getXrplClient(useTestnetNetwork);
        // Use provided seed or connected wallet
        let wallet;
        if (fromSeed) {
            wallet = Wallet.fromSeed(fromSeed);
        }
        else if (connectedWallet) {
            wallet = connectedWallet;
        }
        else {
            throw new Error("No wallet connected. Please connect first using connect-to-xrpl tool or provide a fromSeed.");
        }
        const payment = {
            TransactionType: "Payment",
            Account: wallet.address,
            Amount: xrpl.xrpToDrops(amount),
            Destination: toAddress,
        };
        const prepared = await client.autofill(payment);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        fromAddress: wallet.address,
                        toAddress,
                        amount,
                        network: useTestnetNetwork
                            ? TESTNET_URL
                            : MAINNET_URL,
                        networkType: useTestnetNetwork
                            ? "testnet"
                            : "mainnet",
                        result: result.result,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error transferring XRP: ${error instanceof Error
                        ? error.message
                        : String(error)}`,
                },
            ],
        };
    }
    finally {
        if (client) {
            await client.disconnect();
        }
    }
});
// Register XRPL get-account-info tool
server.tool("get-account-info", "Get account information from the XRP Ledger", {
    address: z
        .string()
        .optional()
        .describe("XRP Ledger account address (starts with r). If not provided, uses the connected wallet's address."),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ address, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        client = await getXrplClient(useTestnetNetwork);
        // Use provided address or connected wallet's address
        const accountAddress = address ||
            (connectedWallet ? connectedWallet.address : undefined);
        if (!accountAddress) {
            throw new Error("No address provided and no wallet connected. Please connect first using connect-to-xrpl tool or provide an address.");
        }
        const response = await client.request({
            command: "account_info",
            account: accountAddress,
            ledger_index: "validated",
        });
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        ...response.result,
                        _meta: {
                            network: useTestnetNetwork
                                ? TESTNET_URL
                                : MAINNET_URL,
                            networkType: useTestnetNetwork
                                ? "testnet"
                                : "mainnet",
                        },
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error getting account info: ${error instanceof Error
                        ? error.message
                        : String(error)}`,
                },
            ],
        };
    }
    finally {
        if (client) {
            await client.disconnect();
        }
    }
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("XRPL MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
