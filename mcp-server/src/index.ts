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
let connectedWallet: Wallet | null = null;
let isConnectedToTestnet = false;

// DID prefix for XRPL
const DID_PREFIX = "did:xrpl:";

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
async function getXrplClient(useTestnet = false): Promise<Client> {
    const serverUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    const client = new Client(serverUrl);
    await client.connect();
    return client;
}

// Helper function to create DID document for an account
function createDIDDocument(
    address: string,
    publicKey: string,
    network: string
) {
    const did = `${DID_PREFIX}${network}:${address}`;

    return {
        "@context": "https://www.w3.org/ns/did/v1",
        id: did,
        controller: did,
        verificationMethod: [
            {
                id: `${did}#keys-1`,
                type: "Ed25519VerificationKey2018",
                controller: did,
                publicKeyHex: publicKey,
            },
        ],
        authentication: [`${did}#keys-1`],
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
    };
}

// Helper function to store DID document in account's memos
async function storeDIDDocument(
    client: Client,
    wallet: Wallet,
    didDocument: any
) {
    // Convert DID document to stringified JSON
    const didDocumentStr = JSON.stringify(didDocument);

    // Create a self-transaction to store the DID document in account memos
    const tx: any = {
        TransactionType: "AccountSet",
        Account: wallet.address,
        Memos: [
            {
                Memo: {
                    MemoType: Buffer.from("did:document")
                        .toString("hex")
                        .toUpperCase(),
                    MemoData: Buffer.from(didDocumentStr)
                        .toString("hex")
                        .toUpperCase(),
                },
            },
        ],
    };

    const prepared = await client.autofill(tx);
    const signed = wallet.sign(prepared);
    return await client.submitAndWait(signed.tx_blob);
}

// Helper function to retrieve DID document from account transactions
async function retrieveDIDDocument(client: Client, address: string) {
    // Get account transactions
    const transactions = await client.request({
        command: "account_tx",
        account: address,
        ledger_index_min: -1,
        ledger_index_max: -1,
        binary: false,
        limit: 100,
        forward: false,
    });

    // Look for the most recent transaction with a DID document memo
    for (const tx of transactions.result.transactions) {
        // Use a more specific type for the transaction object
        const transaction = tx.tx as unknown as {
            Memos?: Array<{
                Memo: {
                    MemoType: string;
                    MemoData: string;
                };
            }>;
        };

        if (transaction && transaction.Memos) {
            for (const memo of transaction.Memos) {
                const memoType = memo.Memo.MemoType;
                const memoData = memo.Memo.MemoData;

                if (
                    Buffer.from(memoType, "hex").toString() === "did:document"
                ) {
                    try {
                        const didDocument = JSON.parse(
                            Buffer.from(memoData, "hex").toString()
                        );
                        return didDocument;
                    } catch (e) {
                        // If parsing fails, continue to the next memo
                        continue;
                    }
                }
            }
        }
    }

    return null;
}

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

// Register XRPL transfer tool
server.tool(
    "transfer-xrp",
    "Transfer XRP between accounts using the connected wallet or a specified seed",
    {
        fromSeed: z
            .string()
            .optional()
            .describe(
                "Optional seed of the wallet to send XRP from. If not provided, the connected wallet will be used."
            ),
        toAddress: z
            .string()
            .describe(
                "XRP Ledger account address to send XRP to (starts with r)"
            ),
        amount: z.string().describe("Amount of XRP to send"),
        useTestnet: z
            .boolean()
            .optional()
            .describe(
                "Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."
            ),
    },
    async ({ fromSeed, toAddress, amount, useTestnet }) => {
        let client: Client | null = null;
        try {
            // Determine which network to use
            // If useTestnet is explicitly provided, use that
            // Otherwise, use the network from the connected wallet
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first using connect-to-xrpl tool or provide a fromSeed."
                );
            }

            const payment = {
                TransactionType: "Payment",
                Account: wallet.address,
                Amount: xrpl.xrpToDrops(amount),
                Destination: toAddress,
            };

            const prepared = await client.autofill(payment as any);
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
                        text: JSON.stringify(
                            {
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
                        text: `Error transferring XRP: ${
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

// Register XRPL get-account-info tool
server.tool(
    "get-account-info",
    "Get account information from the XRP Ledger",
    {
        address: z
            .string()
            .optional()
            .describe(
                "XRP Ledger account address (starts with r). If not provided, uses the connected wallet's address."
            ),
        useTestnet: z
            .boolean()
            .optional()
            .describe(
                "Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."
            ),
    },
    async ({ address, useTestnet }) => {
        let client: Client | null = null;
        try {
            // Determine which network to use
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided address or connected wallet's address
            const accountAddress =
                address ||
                (connectedWallet ? connectedWallet.address : undefined);

            if (!accountAddress) {
                throw new Error(
                    "No address provided and no wallet connected. Please connect first using connect-to-xrpl tool or provide an address."
                );
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
                        text: JSON.stringify(
                            {
                                ...response.result,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error getting account info: ${
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

// ------------ TOKEN SERVICES - ERC20-LIKE TOKENS ------------

// Register get-token-metadata tool
server.tool(
    "get-token-metadata",
    "Get token metadata (name, symbol, decimals, supply)",
    {
        tokenID: z.string().describe("Currency code or token identifier"),
        issuer: z.string().describe("Issuer address for the token"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ tokenID, issuer, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Get token information
            const currencyInfo = await client.request({
                command: "gateway_balances",
                account: issuer,
                strict: true,
                ledger_index: "validated",
            });

            // Get token trust lines to determine circulation
            const accountLines = await client.request({
                command: "account_lines",
                account: issuer,
                ledger_index: "validated",
            });

            // Find the relevant currency
            const lines = accountLines.result.lines || [];
            const tokenInfo = lines.find((line) => line.currency === tokenID);

            const tokenData = {
                name: tokenID,
                symbol: tokenID,
                issuer: issuer,
                decimals: 6, // Default for most XRPL tokens
                totalSupply: tokenInfo ? tokenInfo.balance : "0",
                _meta: {
                    network: useTestnetNetwork ? TESTNET_URL : MAINNET_URL,
                    networkType: useTestnetNetwork ? "testnet" : "mainnet",
                },
            };

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(tokenData, null, 2),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error getting token metadata: ${
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

// Register check-token-balance tool
server.tool(
    "check-token-balance",
    "Check token balance for an address",
    {
        address: z
            .string()
            .optional()
            .describe("Account address to check balance for"),
        currency: z.string().describe("Currency code"),
        issuer: z.string().describe("Issuer address for the token"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ address, currency, issuer, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided address or connected wallet's address
            const accountAddress =
                address ||
                (connectedWallet ? connectedWallet.address : undefined);

            if (!accountAddress) {
                throw new Error("No address provided and no wallet connected.");
            }

            const response = await client.request({
                command: "account_lines",
                account: accountAddress,
                ledger_index: "validated",
            });

            // Find the specific token in the trust lines
            const lines = response.result.lines || [];
            const tokenLine = lines.find(
                (line) => line.currency === currency && line.account === issuer
            );

            const balance = tokenLine ? tokenLine.balance : "0";

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                address: accountAddress,
                                currency,
                                issuer,
                                balance,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error checking token balance: ${
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

// Register transfer-token tool
server.tool(
    "transfer-token",
    "Transfer tokens between addresses",
    {
        fromSeed: z
            .string()
            .optional()
            .describe(
                "Seed of the wallet to send from, if not using connected wallet"
            ),
        toAddress: z.string().describe("Destination address"),
        currency: z.string().describe("Currency code"),
        issuer: z.string().describe("Issuer address for the token"),
        amount: z.string().describe("Amount to send"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ fromSeed, toAddress, currency, issuer, amount, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first or provide a fromSeed."
                );
            }

            // Construct token payment
            const payment = {
                TransactionType: "Payment",
                Account: wallet.address,
                Destination: toAddress,
                Amount: {
                    currency,
                    issuer,
                    value: amount,
                },
            };

            const prepared = await client.autofill(payment as any);
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
                        text: JSON.stringify(
                            {
                                status,
                                hash: result.result.hash,
                                fromAddress: wallet.address,
                                toAddress,
                                currency,
                                issuer,
                                amount,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error transferring token: ${
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

// Register approve-token-spending tool
server.tool(
    "approve-token-spending",
    "Establish trust line to approve token usage",
    {
        fromSeed: z
            .string()
            .optional()
            .describe("Seed of the wallet, if not using connected wallet"),
        currency: z.string().describe("Currency code"),
        issuer: z.string().describe("Issuer address for the token"),
        limit: z.string().describe("Maximum amount approved for use"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ fromSeed, currency, issuer, limit, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first or provide a fromSeed."
                );
            }

            // Create trust line transaction
            const trustSet = {
                TransactionType: "TrustSet",
                Account: wallet.address,
                LimitAmount: {
                    currency,
                    issuer,
                    value: limit,
                },
            };

            const prepared = await client.autofill(trustSet as any);
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
                        text: JSON.stringify(
                            {
                                status,
                                hash: result.result.hash,
                                account: wallet.address,
                                currency,
                                issuer,
                                limit,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error setting trust line: ${
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

// ------------ NFT SERVICES (ERC721-like) ------------

// Register get-nft-metadata tool
server.tool(
    "get-nft-metadata",
    "Get NFT collection and token metadata",
    {
        tokenID: z.string().describe("NFT token ID"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ tokenID, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Get NFT information
            const nftInfo = await client.request({
                command: "nft_info",
                nft_id: tokenID,
                ledger_index: "validated",
            });

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                ...nftInfo.result,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error getting NFT metadata: ${
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

// Register verify-nft-ownership tool
server.tool(
    "verify-nft-ownership",
    "Verify if an address owns a specific NFT",
    {
        address: z
            .string()
            .optional()
            .describe("Account address to check, defaults to connected wallet"),
        tokenID: z.string().describe("NFT token ID"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ address, tokenID, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided address or connected wallet's address
            const accountAddress =
                address ||
                (connectedWallet ? connectedWallet.address : undefined);

            if (!accountAddress) {
                throw new Error("No address provided and no wallet connected.");
            }

            // Get account NFTs
            const accountNfts = await client.request({
                command: "account_nfts",
                account: accountAddress,
                ledger_index: "validated",
            });

            // Check if the specific NFT is owned
            const nfts = accountNfts.result.account_nfts || [];
            const ownsNft = nfts.some((nft) => nft.NFTokenID === tokenID);

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                address: accountAddress,
                                tokenID,
                                ownsNft,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error verifying NFT ownership: ${
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

// Register transfer-nft tool
server.tool(
    "transfer-nft",
    "Transfer NFT between addresses",
    {
        fromSeed: z
            .string()
            .optional()
            .describe(
                "Seed of the wallet to send from, if not using connected wallet"
            ),
        toAddress: z.string().describe("Destination address"),
        tokenID: z.string().describe("NFT token ID to transfer"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ fromSeed, toAddress, tokenID, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first or provide a fromSeed."
                );
            }

            // Create NFT transfer transaction
            const nftSellOffer = {
                TransactionType: "NFTokenCreateOffer",
                Account: wallet.address,
                NFTokenID: tokenID,
                Amount: "0",
                Flags: 1, // tfSellToken
                Destination: toAddress,
            };

            const prepared = await client.autofill(nftSellOffer as any);
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
                        text: JSON.stringify(
                            {
                                status,
                                hash: result.result.hash,
                                fromAddress: wallet.address,
                                toAddress,
                                tokenID,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error transferring NFT: ${
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

// Register get-nft-collection tool
server.tool(
    "get-nft-collection",
    "Get all NFTs owned by an address",
    {
        address: z
            .string()
            .optional()
            .describe("Account address to check, defaults to connected wallet"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ address, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            client = await getXrplClient(useTestnetNetwork);

            // Use provided address or connected wallet's address
            const accountAddress =
                address ||
                (connectedWallet ? connectedWallet.address : undefined);

            if (!accountAddress) {
                throw new Error("No address provided and no wallet connected.");
            }

            // Get account NFTs
            const accountNfts = await client.request({
                command: "account_nfts",
                account: accountAddress,
                ledger_index: "validated",
            });

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                address: accountAddress,
                                count:
                                    accountNfts.result.account_nfts?.length ||
                                    0,
                                nfts: accountNfts.result.account_nfts || [],
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error getting NFT collection: ${
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

// ------------ DID SERVICES ------------

// Register create-did tool
server.tool(
    "create-did",
    "Create a decentralized identifier (DID) for an XRPL account",
    {
        fromSeed: z
            .string()
            .optional()
            .describe(
                "Seed of the wallet to create DID for, if not using connected wallet"
            ),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ fromSeed, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            const networkStr = useTestnetNetwork ? "testnet" : "mainnet";
            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first or provide a fromSeed."
                );
            }

            // Create DID document
            const didDocument = createDIDDocument(
                wallet.address,
                wallet.publicKey,
                networkStr
            );

            // Store DID document on the ledger
            const result = await storeDIDDocument(client, wallet, didDocument);

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
                        text: JSON.stringify(
                            {
                                status,
                                did: didDocument.id,
                                controller: wallet.address,
                                transaction: result.result.hash,
                                didDocument,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: networkStr,
                                },
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
                        text: `Error creating DID: ${
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

// Register resolve-did tool
server.tool(
    "resolve-did",
    "Resolve a DID to retrieve its DID document",
    {
        did: z
            .string()
            .describe(
                "The DID to resolve (format: did:xrpl:[network]:[address])"
            ),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ did, useTestnet }) => {
        let client: Client | null = null;
        try {
            // Parse DID to extract network and address
            if (!did.startsWith(DID_PREFIX)) {
                throw new Error(
                    `Invalid DID format. Must start with ${DID_PREFIX}`
                );
            }

            const parts = did.substring(DID_PREFIX.length).split(":");
            if (parts.length !== 2) {
                throw new Error(
                    "Invalid DID format. Expected format: did:xrpl:[network]:[address]"
                );
            }

            const [network, address] = parts;
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : network === "testnet";

            client = await getXrplClient(useTestnetNetwork);

            // Retrieve DID document
            const didDocument = await retrieveDIDDocument(client, address);

            if (!didDocument) {
                throw new Error(
                    "DID document not found for the specified address"
                );
            }

            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            {
                                did,
                                didDocument,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: useTestnetNetwork
                                        ? "testnet"
                                        : "mainnet",
                                },
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
                        text: `Error resolving DID: ${
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

// Register update-did tool
server.tool(
    "update-did",
    "Update a DID document with new properties",
    {
        fromSeed: z
            .string()
            .optional()
            .describe(
                "Seed of the wallet that controls the DID, if not using connected wallet"
            ),
        additionalKeys: z
            .array(
                z.object({
                    id: z.string(),
                    type: z.string(),
                    publicKeyHex: z.string(),
                })
            )
            .optional()
            .describe(
                "Additional verification keys to add to the DID document"
            ),
        serviceEndpoints: z
            .array(
                z.object({
                    id: z.string(),
                    type: z.string(),
                    serviceEndpoint: z.string(),
                })
            )
            .optional()
            .describe("Service endpoints to add to the DID document"),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ fromSeed, additionalKeys, serviceEndpoints, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            const networkStr = useTestnetNetwork ? "testnet" : "mainnet";
            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first or provide a fromSeed."
                );
            }

            // Get existing DID document
            const existingDidDocument = await retrieveDIDDocument(
                client,
                wallet.address
            );

            if (!existingDidDocument) {
                throw new Error(
                    "No existing DID document found. Create a DID first."
                );
            }

            // Update DID document
            const updatedDidDocument = {
                ...existingDidDocument,
                updated: new Date().toISOString(),
            };

            // Add additional verification methods if provided
            if (additionalKeys && additionalKeys.length > 0) {
                const allKeys = [
                    ...(updatedDidDocument.verificationMethod || []),
                    ...additionalKeys.map((key) => ({
                        ...key,
                        controller: updatedDidDocument.id,
                    })),
                ];

                // Remove duplicates by id
                const keyMap = new Map();
                allKeys.forEach((key) => keyMap.set(key.id, key));
                updatedDidDocument.verificationMethod = Array.from(
                    keyMap.values()
                );
            }

            // Add service endpoints if provided
            if (serviceEndpoints && serviceEndpoints.length > 0) {
                if (!updatedDidDocument.service) {
                    updatedDidDocument.service = [];
                }

                const allServices = [
                    ...updatedDidDocument.service,
                    ...serviceEndpoints,
                ];

                // Remove duplicates by id
                const serviceMap = new Map();
                allServices.forEach((service) =>
                    serviceMap.set(service.id, service)
                );
                updatedDidDocument.service = Array.from(serviceMap.values());
            }

            // Store updated DID document
            const result = await storeDIDDocument(
                client,
                wallet,
                updatedDidDocument
            );

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
                        text: JSON.stringify(
                            {
                                status,
                                did: updatedDidDocument.id,
                                transaction: result.result.hash,
                                didDocument: updatedDidDocument,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: networkStr,
                                },
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
                        text: `Error updating DID: ${
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

// Register deactivate-did tool
server.tool(
    "deactivate-did",
    "Deactivate a DID by marking it as revoked",
    {
        fromSeed: z
            .string()
            .optional()
            .describe(
                "Seed of the wallet that controls the DID, if not using connected wallet"
            ),
        useTestnet: z
            .boolean()
            .optional()
            .describe("Whether to use testnet or mainnet"),
    },
    async ({ fromSeed, useTestnet }) => {
        let client: Client | null = null;
        try {
            const useTestnetNetwork =
                useTestnet !== undefined ? useTestnet : isConnectedToTestnet;

            const networkStr = useTestnetNetwork ? "testnet" : "mainnet";
            client = await getXrplClient(useTestnetNetwork);

            // Use provided seed or connected wallet
            let wallet: Wallet;
            if (fromSeed) {
                wallet = Wallet.fromSeed(fromSeed);
            } else if (connectedWallet) {
                wallet = connectedWallet;
            } else {
                throw new Error(
                    "No wallet connected. Please connect first or provide a fromSeed."
                );
            }

            // Get existing DID document
            const existingDidDocument = await retrieveDIDDocument(
                client,
                wallet.address
            );

            if (!existingDidDocument) {
                throw new Error(
                    "No existing DID document found to deactivate."
                );
            }

            // Update DID document to mark as deactivated
            const deactivatedDidDocument = {
                ...existingDidDocument,
                updated: new Date().toISOString(),
                deactivated: true,
            };

            // Store deactivated DID document
            const result = await storeDIDDocument(
                client,
                wallet,
                deactivatedDidDocument
            );

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
                        text: JSON.stringify(
                            {
                                status,
                                did: deactivatedDidDocument.id,
                                deactivated: true,
                                transaction: result.result.hash,
                                _meta: {
                                    network: useTestnetNetwork
                                        ? TESTNET_URL
                                        : MAINNET_URL,
                                    networkType: networkStr,
                                },
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
                        text: `Error deactivating DID: ${
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

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("XRPL MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
