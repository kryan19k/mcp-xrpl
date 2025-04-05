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
async function getXrplClient(useTestnet = false) {
    const serverUrl = useTestnet ? TESTNET_URL : MAINNET_URL;
    const client = new Client(serverUrl);
    await client.connect();
    return client;
}
// Helper function to create DID document for an account
function createDIDDocument(address, publicKey, network) {
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
async function storeDIDDocument(client, wallet, didDocument) {
    // Convert DID document to stringified JSON
    const didDocumentStr = JSON.stringify(didDocument);
    // Create a self-transaction to store the DID document in account memos
    const tx = {
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
async function retrieveDIDDocument(client, address) {
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
        const transaction = tx.tx;
        if (transaction && transaction.Memos) {
            for (const memo of transaction.Memos) {
                const memoType = memo.Memo.MemoType;
                const memoData = memo.Memo.MemoData;
                if (Buffer.from(memoType, "hex").toString() === "did:document") {
                    try {
                        const didDocument = JSON.parse(Buffer.from(memoData, "hex").toString());
                        return didDocument;
                    }
                    catch (e) {
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
// Register delete-account tool
server.tool("delete-account", "Delete an XRP Ledger account and send remaining XRP to a destination account", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to delete. If not provided, the connected wallet will be used."),
    destinationAccount: z
        .string()
        .describe("XRP Ledger account address to receive remaining XRP (starts with r)"),
    destinationTag: z
        .number()
        .optional()
        .describe("Optional destination tag to identify the recipient"),
    fee: z
        .string()
        .optional()
        .describe("Transaction fee (in XRP). Must be at least 0.2 XRP for account deletion."),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, destinationAccount, destinationTag, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Set default fee to 0.2 XRP (minimum required for account deletion)
        const accountDeleteFee = fee || "200000"; // 0.2 XRP in drops
        // Create AccountDelete transaction
        const deleteTransaction = {
            TransactionType: "AccountDelete",
            Account: wallet.address,
            Destination: destinationAccount,
            Fee: accountDeleteFee,
        };
        // Add destination tag if provided
        if (destinationTag !== undefined) {
            deleteTransaction.DestinationTag = destinationTag;
        }
        // Get account info to check if deletion is possible
        try {
            const accountInfo = await client.request({
                command: "account_info",
                account: wallet.address,
                ledger_index: "validated",
            });
            // Verify sequence number isn't too high
            const currentLedgerIndex = await client.getLedgerIndex();
            if (Number(accountInfo.result.account_data.Sequence) + 256 >=
                currentLedgerIndex) {
                throw new Error("Account sequence number is too high for deletion. The sequence plus 256 must be less than the current ledger index.");
            }
        }
        catch (error) {
            if (error instanceof Error) {
                throw error;
            }
            throw new Error("Failed to validate account for deletion");
        }
        // Submit with fail_hard to avoid paying the fee if deletion fails
        const prepared = await client.autofill(deleteTransaction);
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
                        deletedAccount: wallet.address,
                        destinationAccount,
                        destinationTag,
                        fee: accountDeleteFee,
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
                    text: `Error deleting account: ${error instanceof Error
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
// Register set-account-properties tool
server.tool("set-account-properties", "Set or modify account properties on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to modify. If not provided, the connected wallet will be used."),
    domain: z
        .string()
        .optional()
        .describe("Domain name to associate with this account (in hex format)"),
    emailHash: z
        .string()
        .optional()
        .describe("MD5 hash of an email address for Gravatar (in hex)"),
    messageKey: z
        .string()
        .optional()
        .describe("Public key for sending encrypted messages to this account"),
    transferRate: z
        .number()
        .optional()
        .describe("Fee to charge when users transfer this account's tokens (in billionths)"),
    tickSize: z
        .number()
        .optional()
        .describe("Tick size for offers (between 3-15, or 0 to disable)"),
    setFlag: z
        .number()
        .optional()
        .describe("Integer flag to enable for this account"),
    clearFlag: z
        .number()
        .optional()
        .describe("Integer flag to disable for this account"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, domain, emailHash, messageKey, transferRate, tickSize, setFlag, clearFlag, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create AccountSet transaction
        const accountSetTx = {
            TransactionType: "AccountSet",
            Account: wallet.address,
        };
        // Add optional fields if provided
        if (domain !== undefined) {
            accountSetTx.Domain = domain;
        }
        if (emailHash !== undefined) {
            accountSetTx.EmailHash = emailHash;
        }
        if (messageKey !== undefined) {
            accountSetTx.MessageKey = messageKey;
        }
        if (transferRate !== undefined) {
            accountSetTx.TransferRate = transferRate;
        }
        if (tickSize !== undefined) {
            accountSetTx.TickSize = tickSize;
        }
        if (setFlag !== undefined) {
            accountSetTx.SetFlag = setFlag;
        }
        if (clearFlag !== undefined) {
            accountSetTx.ClearFlag = clearFlag;
        }
        if (fee !== undefined) {
            accountSetTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(accountSetTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get updated account info
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
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        updatedProperties: {
                            domain: domain !== undefined
                                ? domain
                                : undefined,
                            emailHash: emailHash !== undefined
                                ? emailHash
                                : undefined,
                            messageKey: messageKey !== undefined
                                ? messageKey
                                : undefined,
                            transferRate: transferRate !== undefined
                                ? transferRate
                                : undefined,
                            tickSize: tickSize !== undefined
                                ? tickSize
                                : undefined,
                            setFlag: setFlag !== undefined
                                ? setFlag
                                : undefined,
                            clearFlag: clearFlag !== undefined
                                ? clearFlag
                                : undefined,
                        },
                        accountFlags: accountInfo.result.account_data.Flags,
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
                    text: `Error setting account properties: ${error instanceof Error
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
// ------------ TOKEN SERVICES - ERC20-LIKE TOKENS ------------
// Register get-token-metadata tool
server.tool("get-token-metadata", "Get token metadata (name, symbol, decimals, supply)", {
    tokenID: z.string().describe("Currency code or token identifier"),
    issuer: z.string().describe("Issuer address for the token"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ tokenID, issuer, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
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
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error getting token metadata: ${error instanceof Error
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
// Register check-token-balance tool
server.tool("check-token-balance", "Check token balance for an address", {
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
}, async ({ address, currency, issuer, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        client = await getXrplClient(useTestnetNetwork);
        // Use provided address or connected wallet's address
        const accountAddress = address ||
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
        const tokenLine = lines.find((line) => line.currency === currency && line.account === issuer);
        const balance = tokenLine ? tokenLine.balance : "0";
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
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
                    text: `Error checking token balance: ${error instanceof Error
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
// Register transfer-token tool
server.tool("transfer-token", "Transfer tokens between addresses", {
    fromSeed: z
        .string()
        .optional()
        .describe("Seed of the wallet to send from, if not using connected wallet"),
    toAddress: z.string().describe("Destination address"),
    currency: z.string().describe("Currency code"),
    issuer: z.string().describe("Issuer address for the token"),
    amount: z.string().describe("Amount to send"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ fromSeed, toAddress, currency, issuer, amount, useTestnet }) => {
    let client = null;
    try {
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
            throw new Error("No wallet connected. Please connect first or provide a fromSeed.");
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
                    text: `Error transferring token: ${error instanceof Error
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
// Register approve-token-spending tool
server.tool("approve-token-spending", "Establish trust line to approve token usage", {
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
}, async ({ fromSeed, currency, issuer, limit, useTestnet }) => {
    let client = null;
    try {
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
            throw new Error("No wallet connected. Please connect first or provide a fromSeed.");
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
        const prepared = await client.autofill(trustSet);
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
                    text: `Error setting trust line: ${error instanceof Error
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
// ------------ NFT SERVICES (ERC721-like) ------------
// Register get-nft-metadata tool
server.tool("get-nft-metadata", "Get NFT collection and token metadata", {
    tokenID: z.string().describe("NFT token ID"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ tokenID, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
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
                    text: JSON.stringify({
                        ...nftInfo.result,
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
                    text: `Error getting NFT metadata: ${error instanceof Error
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
// Register verify-nft-ownership tool
server.tool("verify-nft-ownership", "Verify if an address owns a specific NFT", {
    address: z
        .string()
        .optional()
        .describe("Account address to check, defaults to connected wallet"),
    tokenID: z.string().describe("NFT token ID"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ address, tokenID, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        client = await getXrplClient(useTestnetNetwork);
        // Use provided address or connected wallet's address
        const accountAddress = address ||
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
                    text: JSON.stringify({
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
                    text: `Error verifying NFT ownership: ${error instanceof Error
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
// Register transfer-nft tool
server.tool("transfer-nft", "Transfer NFT between addresses", {
    fromSeed: z
        .string()
        .optional()
        .describe("Seed of the wallet to send from, if not using connected wallet"),
    toAddress: z.string().describe("Destination address"),
    tokenID: z.string().describe("NFT token ID to transfer"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ fromSeed, toAddress, tokenID, useTestnet }) => {
    let client = null;
    try {
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
            throw new Error("No wallet connected. Please connect first or provide a fromSeed.");
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
        const prepared = await client.autofill(nftSellOffer);
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
                        tokenID,
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
                    text: `Error transferring NFT: ${error instanceof Error
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
// Register get-nft-collection tool
server.tool("get-nft-collection", "Get all NFTs owned by an address", {
    address: z
        .string()
        .optional()
        .describe("Account address to check, defaults to connected wallet"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ address, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        client = await getXrplClient(useTestnetNetwork);
        // Use provided address or connected wallet's address
        const accountAddress = address ||
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
                    text: JSON.stringify({
                        address: accountAddress,
                        count: accountNfts.result.account_nfts?.length ||
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
                    text: `Error getting NFT collection: ${error instanceof Error
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
// ------------ DID SERVICES ------------
// Register create-did tool
server.tool("create-did", "Create a decentralized identifier (DID) for an XRPL account", {
    fromSeed: z
        .string()
        .optional()
        .describe("Seed of the wallet to create DID for, if not using connected wallet"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ fromSeed, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        const networkStr = useTestnetNetwork ? "testnet" : "mainnet";
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
            throw new Error("No wallet connected. Please connect first or provide a fromSeed.");
        }
        // Create DID document
        const didDocument = createDIDDocument(wallet.address, wallet.publicKey, networkStr);
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
                    text: JSON.stringify({
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
                    text: `Error creating DID: ${error instanceof Error
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
// Register resolve-did tool
server.tool("resolve-did", "Resolve a DID to retrieve its DID document", {
    did: z
        .string()
        .describe("The DID to resolve (format: did:xrpl:[network]:[address])"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ did, useTestnet }) => {
    let client = null;
    try {
        // Parse DID to extract network and address
        if (!did.startsWith(DID_PREFIX)) {
            throw new Error(`Invalid DID format. Must start with ${DID_PREFIX}`);
        }
        const parts = did.substring(DID_PREFIX.length).split(":");
        if (parts.length !== 2) {
            throw new Error("Invalid DID format. Expected format: did:xrpl:[network]:[address]");
        }
        const [network, address] = parts;
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : network === "testnet";
        client = await getXrplClient(useTestnetNetwork);
        // Retrieve DID document
        const didDocument = await retrieveDIDDocument(client, address);
        if (!didDocument) {
            throw new Error("DID document not found for the specified address");
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
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
                    text: `Error resolving DID: ${error instanceof Error
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
// Register update-did tool
server.tool("update-did", "Update a DID document with new properties", {
    fromSeed: z
        .string()
        .optional()
        .describe("Seed of the wallet that controls the DID, if not using connected wallet"),
    additionalKeys: z
        .array(z.object({
        id: z.string(),
        type: z.string(),
        publicKeyHex: z.string(),
    }))
        .optional()
        .describe("Additional verification keys to add to the DID document"),
    serviceEndpoints: z
        .array(z.object({
        id: z.string(),
        type: z.string(),
        serviceEndpoint: z.string(),
    }))
        .optional()
        .describe("Service endpoints to add to the DID document"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ fromSeed, additionalKeys, serviceEndpoints, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        const networkStr = useTestnetNetwork ? "testnet" : "mainnet";
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
            throw new Error("No wallet connected. Please connect first or provide a fromSeed.");
        }
        // Get existing DID document
        const existingDidDocument = await retrieveDIDDocument(client, wallet.address);
        if (!existingDidDocument) {
            throw new Error("No existing DID document found. Create a DID first.");
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
            updatedDidDocument.verificationMethod = Array.from(keyMap.values());
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
            allServices.forEach((service) => serviceMap.set(service.id, service));
            updatedDidDocument.service = Array.from(serviceMap.values());
        }
        // Store updated DID document
        const result = await storeDIDDocument(client, wallet, updatedDidDocument);
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
                        did: updatedDidDocument.id,
                        transaction: result.result.hash,
                        didDocument: updatedDidDocument,
                        _meta: {
                            network: useTestnetNetwork
                                ? TESTNET_URL
                                : MAINNET_URL,
                            networkType: networkStr,
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
                    text: `Error updating DID: ${error instanceof Error
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
// Register deactivate-did tool
server.tool("deactivate-did", "Deactivate a DID by marking it as revoked", {
    fromSeed: z
        .string()
        .optional()
        .describe("Seed of the wallet that controls the DID, if not using connected wallet"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use testnet or mainnet"),
}, async ({ fromSeed, useTestnet }) => {
    let client = null;
    try {
        const useTestnetNetwork = useTestnet !== undefined ? useTestnet : isConnectedToTestnet;
        const networkStr = useTestnetNetwork ? "testnet" : "mainnet";
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
            throw new Error("No wallet connected. Please connect first or provide a fromSeed.");
        }
        // Get existing DID document
        const existingDidDocument = await retrieveDIDDocument(client, wallet.address);
        if (!existingDidDocument) {
            throw new Error("No existing DID document found to deactivate.");
        }
        // Update DID document to mark as deactivated
        const deactivatedDidDocument = {
            ...existingDidDocument,
            updated: new Date().toISOString(),
            deactivated: true,
        };
        // Store deactivated DID document
        const result = await storeDIDDocument(client, wallet, deactivatedDidDocument);
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
                        did: deactivatedDidDocument.id,
                        deactivated: true,
                        transaction: result.result.hash,
                        _meta: {
                            network: useTestnetNetwork
                                ? TESTNET_URL
                                : MAINNET_URL,
                            networkType: networkStr,
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
                    text: `Error deactivating DID: ${error instanceof Error
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
// Register amm-bid tool
server.tool("amm-bid", "Bid on an Automated Market Maker's auction slot for discounted trading fees", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    asset1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
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
            .describe("Issuer address of the second asset (not needed for XRP)"),
    })
        .describe("Second asset in the AMM's pool"),
    bidMax: z
        .object({
        currency: z.string().describe("Currency code of the LP Token"),
        issuer: z.string().describe("Issuer address of the LP Token"),
        value: z
            .string()
            .describe("Maximum amount of LP Tokens to bid"),
    })
        .optional()
        .describe("Maximum amount to bid for the auction slot"),
    bidMin: z
        .object({
        currency: z.string().describe("Currency code of the LP Token"),
        issuer: z.string().describe("Issuer address of the LP Token"),
        value: z
            .string()
            .describe("Minimum amount of LP Tokens to bid"),
    })
        .optional()
        .describe("Minimum amount to bid for the auction slot"),
    authAccounts: z
        .array(z
        .string()
        .describe("Account address to authorize for discounted trading"))
        .max(4)
        .optional()
        .describe("Up to 4 additional accounts to authorize for discounted trading"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, asset1, asset2, bidMax, bidMin, authAccounts, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format assets for the transaction
        const formatAsset = (asset) => {
            if (asset.currency === "XRP") {
                return { currency: "XRP" };
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                };
            }
        };
        // Create AMMBid transaction
        const ammBidTx = {
            TransactionType: "AMMBid",
            Account: wallet.address,
            Asset: formatAsset(asset1),
            Asset2: formatAsset(asset2),
        };
        // Add optional fields if provided
        if (bidMax) {
            ammBidTx.BidMax = bidMax;
        }
        if (bidMin) {
            ammBidTx.BidMin = bidMin;
        }
        if (authAccounts && authAccounts.length > 0) {
            ammBidTx.AuthAccounts = authAccounts.map((account) => ({
                AuthAccount: {
                    Account: account,
                },
            }));
        }
        if (fee) {
            ammBidTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ammBidTx);
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
                        account: wallet.address,
                        asset1,
                        asset2,
                        bidMax: bidMax || "Not specified",
                        bidMin: bidMin || "Not specified",
                        authAccounts: authAccounts || [],
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
                    text: `Error placing AMM bid: ${error instanceof Error
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
// Register amm-create tool
server.tool("amm-create", "Create a new Automated Market Maker (AMM) on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    asset1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
        value: z
            .string()
            .describe("Amount of the first asset to deposit"),
    })
        .describe("First asset to deposit in the AMM's pool"),
    asset2: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the second asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the second asset (not needed for XRP)"),
        value: z
            .string()
            .describe("Amount of the second asset to deposit"),
    })
        .describe("Second asset to deposit in the AMM's pool"),
    tradingFee: z
        .number()
        .min(0)
        .max(1000)
        .optional()
        .describe("Trading fee in basis points (0-1000, where 100 = 1%)"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, asset1, asset2, tradingFee, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format amounts for the transaction
        const formatAmount = (asset) => {
            if (asset.currency === "XRP") {
                return xrpl.xrpToDrops(asset.value);
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                    value: asset.value,
                };
            }
        };
        // Create AMMCreate transaction
        const ammCreateTx = {
            TransactionType: "AMMCreate",
            Account: wallet.address,
            Amount: formatAmount(asset1),
            Amount2: formatAmount(asset2),
        };
        // Add optional fields if provided
        if (tradingFee !== undefined) {
            ammCreateTx.TradingFee = tradingFee;
        }
        if (fee) {
            ammCreateTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ammCreateTx);
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
                        account: wallet.address,
                        asset1,
                        asset2,
                        tradingFee: tradingFee !== undefined
                            ? tradingFee
                            : "Default (0)",
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
                    text: `Error creating AMM: ${error instanceof Error
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
// Register amm-deposit tool
server.tool("amm-deposit", "Deposit assets into an existing Automated Market Maker (AMM) on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    asset1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
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
            .describe("Issuer address of the second asset (not needed for XRP)"),
    })
        .describe("Second asset in the AMM's pool"),
    amount1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
        value: z
            .string()
            .describe("Amount of the first asset to deposit"),
    })
        .optional()
        .describe("Amount of the first asset to deposit"),
    amount2: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the second asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the second asset (not needed for XRP)"),
        value: z
            .string()
            .describe("Amount of the second asset to deposit"),
    })
        .optional()
        .describe("Amount of the second asset to deposit"),
    lpTokensOut: z
        .object({
        currency: z.string().describe("Currency code of LP token"),
        issuer: z.string().describe("Issuer address of LP token"),
        value: z
            .string()
            .describe("Minimum amount of LP tokens to receive"),
    })
        .optional()
        .describe("Minimum amount of LP tokens to receive"),
    singleAsset: z
        .boolean()
        .optional()
        .describe("Whether to deposit only a single asset type"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, asset1, asset2, amount1, amount2, lpTokensOut, singleAsset, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format assets for the transaction
        const formatAsset = (asset) => {
            if (asset.currency === "XRP") {
                return { currency: "XRP" };
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                };
            }
        };
        // Format amounts for the transaction
        const formatAmount = (asset) => {
            if (asset.currency === "XRP") {
                return xrpl.xrpToDrops(asset.value);
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                    value: asset.value,
                };
            }
        };
        // Create AMMDeposit transaction
        const ammDepositTx = {
            TransactionType: "AMMDeposit",
            Account: wallet.address,
            Asset: formatAsset(asset1),
            Asset2: formatAsset(asset2),
        };
        // Add optional fields if provided
        if (amount1) {
            ammDepositTx.Amount = formatAmount(amount1);
        }
        if (amount2) {
            ammDepositTx.Amount2 = formatAmount(amount2);
        }
        if (lpTokensOut) {
            ammDepositTx.LPTokenOut = lpTokensOut;
        }
        // Set flags if needed
        if (singleAsset) {
            // Set the tfSingleAsset flag (0x00010000 = 65536)
            ammDepositTx.Flags = 65536;
        }
        if (fee) {
            ammDepositTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ammDepositTx);
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
                        account: wallet.address,
                        asset1,
                        asset2,
                        amount1: amount1 || "Not specified",
                        amount2: amount2 || "Not specified",
                        lpTokensOut: lpTokensOut || "Not specified",
                        singleAsset: singleAsset || false,
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
                    text: `Error depositing to AMM: ${error instanceof Error
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
// Register amm-delete tool
server.tool("amm-delete", "Delete an Automated Market Maker (AMM) from the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    asset1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
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
            .describe("Issuer address of the second asset (not needed for XRP)"),
    })
        .describe("Second asset in the AMM's pool"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, asset1, asset2, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format assets for the transaction
        const formatAsset = (asset) => {
            if (asset.currency === "XRP") {
                return { currency: "XRP" };
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                };
            }
        };
        // Create AMMDelete transaction
        const ammDeleteTx = {
            TransactionType: "AMMDelete",
            Account: wallet.address,
            Asset: formatAsset(asset1),
            Asset2: formatAsset(asset2),
        };
        // Add optional fee if provided
        if (fee) {
            ammDeleteTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ammDeleteTx);
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
                        account: wallet.address,
                        asset1,
                        asset2,
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
                    text: `Error deleting AMM: ${error instanceof Error
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
// Register amm-vote tool
server.tool("amm-vote", "Vote on parameters for an Automated Market Maker (AMM)", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    asset1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
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
            .describe("Issuer address of the second asset (not needed for XRP)"),
    })
        .describe("Second asset in the AMM's pool"),
    tradingFee: z
        .number()
        .min(0)
        .max(1000)
        .optional()
        .describe("Trading fee in basis points (0-1000, where 100 = 1%)"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, asset1, asset2, tradingFee, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format assets for the transaction
        const formatAsset = (asset) => {
            if (asset.currency === "XRP") {
                return { currency: "XRP" };
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                };
            }
        };
        // Create AMMVote transaction
        const ammVoteTx = {
            TransactionType: "AMMVote",
            Account: wallet.address,
            Asset: formatAsset(asset1),
            Asset2: formatAsset(asset2),
        };
        // Add optional fields if provided
        if (tradingFee !== undefined) {
            ammVoteTx.TradingFee = tradingFee;
        }
        if (fee) {
            ammVoteTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ammVoteTx);
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
                        account: wallet.address,
                        asset1,
                        asset2,
                        tradingFee: tradingFee !== undefined
                            ? tradingFee
                            : "Not voted on",
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
                    text: `Error voting on AMM: ${error instanceof Error
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
// Register amm-clawback tool
server.tool("amm-clawback", "Clawback assets from an Automated Market Maker (AMM)", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    asset1: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the first asset"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address of the first asset (not needed for XRP)"),
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
            .describe("Issuer address of the second asset (not needed for XRP)"),
    })
        .describe("Second asset in the AMM's pool"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, asset1, asset2, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format assets for the transaction
        const formatAsset = (asset) => {
            if (asset.currency === "XRP") {
                return { currency: "XRP" };
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                };
            }
        };
        // Create AMMClawback transaction
        const ammClawbackTx = {
            TransactionType: "AMMClawback",
            Account: wallet.address,
            Asset: formatAsset(asset1),
            Asset2: formatAsset(asset2),
        };
        // Add optional fee if provided
        if (fee) {
            ammClawbackTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ammClawbackTx);
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
                        account: wallet.address,
                        asset1,
                        asset2,
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
                    text: `Error performing AMM clawback: ${error instanceof Error
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
// Register check-cancel tool
server.tool("check-cancel", "Cancel an unredeemed Check, removing it from the ledger without sending any money", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    checkID: z
        .string()
        .describe("The ID of the Check ledger object to cancel, as a 64-character hexadecimal string"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, checkID, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create CheckCancel transaction
        const checkCancelTx = {
            TransactionType: "CheckCancel",
            Account: wallet.address,
            CheckID: checkID,
        };
        // Add optional fee if provided
        if (fee) {
            checkCancelTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(checkCancelTx);
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
                        account: wallet.address,
                        checkID,
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
                    text: `Error cancelling Check: ${error instanceof Error
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
// Register check-cash tool
server.tool("check-cash", "Cash a Check to receive funds from it", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    checkID: z
        .string()
        .describe("The ID of the Check ledger object to cash, as a 64-character hexadecimal string"),
    amount: z
        .object({
        currency: z.string().describe("Currency code"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address (not needed for XRP)"),
        value: z.string().describe("Amount to cash"),
    })
        .optional()
        .describe("Amount to cash. Required for Checks with a sendMax, or to cash a lesser amount"),
    deliverMin: z
        .object({
        currency: z.string().describe("Currency code"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address (not needed for XRP)"),
        value: z.string().describe("Minimum amount to receive"),
    })
        .optional()
        .describe("Minimum amount to receive. Required for Checks with an amount"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, checkID, amount, deliverMin, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format amounts for the transaction
        const formatAmount = (asset) => {
            if (asset.currency === "XRP") {
                return xrpl.xrpToDrops(asset.value);
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                    value: asset.value,
                };
            }
        };
        // Create CheckCash transaction
        const checkCashTx = {
            TransactionType: "CheckCash",
            Account: wallet.address,
            CheckID: checkID,
        };
        // Add either Amount or DeliverMin - one is required but not both
        if (amount) {
            checkCashTx.Amount = formatAmount(amount);
        }
        else if (deliverMin) {
            checkCashTx.DeliverMin = formatAmount(deliverMin);
        }
        else {
            throw new Error("Either amount or deliverMin must be provided to cash a Check");
        }
        // Add optional fee if provided
        if (fee) {
            checkCashTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(checkCashTx);
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
                        account: wallet.address,
                        checkID,
                        amount: amount || "Not specified",
                        deliverMin: deliverMin || "Not specified",
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
                    text: `Error cashing Check: ${error instanceof Error
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
// Register check-create tool
server.tool("check-create", "Create a Check that can be cashed by the destination account", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    destination: z
        .string()
        .describe("The XRP Ledger address that can cash the Check"),
    sendMax: z
        .object({
        currency: z.string().describe("Currency code"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer address (not needed for XRP)"),
        value: z
            .string()
            .describe("Maximum amount the Check can debit from your account"),
    })
        .describe("Maximum amount the Check can debit from your account"),
    destinationTag: z
        .number()
        .optional()
        .describe("Destination tag to identify the beneficiary or purpose at the destination account"),
    expiration: z
        .number()
        .optional()
        .describe("Time after which the Check expires, in seconds since the Ripple Epoch"),
    invoiceID: z
        .string()
        .optional()
        .describe("Arbitrary 256-bit hash representing a specific reason or identifier for this Check"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, destination, sendMax, destinationTag, expiration, invoiceID, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format amounts for the transaction
        const formatAmount = (asset) => {
            if (asset.currency === "XRP") {
                return xrpl.xrpToDrops(asset.value);
            }
            else {
                return {
                    currency: asset.currency,
                    issuer: asset.issuer,
                    value: asset.value,
                };
            }
        };
        // Create CheckCreate transaction
        const checkCreateTx = {
            TransactionType: "CheckCreate",
            Account: wallet.address,
            Destination: destination,
            SendMax: formatAmount(sendMax),
        };
        // Add optional fields if provided
        if (destinationTag !== undefined) {
            checkCreateTx.DestinationTag = destinationTag;
        }
        if (expiration !== undefined) {
            checkCreateTx.Expiration = expiration;
        }
        if (invoiceID !== undefined) {
            checkCreateTx.InvoiceID = invoiceID;
        }
        if (fee) {
            checkCreateTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(checkCreateTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Extract CheckID from transaction metadata
        let checkID = null;
        if (status === "success" &&
            typeof result.result.meta !== "string" &&
            result.result.meta &&
            result.result.meta.AffectedNodes) {
            for (const node of result.result.meta.AffectedNodes) {
                if ("CreatedNode" in node &&
                    node.CreatedNode.LedgerEntryType === "Check") {
                    checkID = node.CreatedNode.LedgerIndex;
                    break;
                }
            }
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        destination,
                        sendMax,
                        destinationTag: destinationTag || "Not specified",
                        expiration: expiration || "Not specified",
                        invoiceID: invoiceID || "Not specified",
                        checkID: checkID || "Not found in metadata",
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
                    text: `Error creating Check: ${error instanceof Error
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
// Register clawback tool
server.tool("clawback", "Claw back tokens issued by your account", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the issuer wallet to use. If not provided, the connected wallet will be used."),
    amount: z
        .object({
        currency: z
            .string()
            .describe("Currency code of the token to claw back"),
        issuer: z
            .string()
            .describe("Address of the token holder (not the issuer)"),
        value: z.string().describe("Amount to claw back"),
    })
        .describe("The amount being clawed back and the holder from which to claw back"),
    holder: z
        .string()
        .optional()
        .describe("(Optional) Specifies the holder's address from which to claw back an MPToken"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, amount, holder, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create Clawback transaction
        const clawbackTx = {
            TransactionType: "Clawback",
            Account: wallet.address,
            Amount: amount,
        };
        // Add optional holder field for MPTokens if provided
        if (holder !== undefined) {
            clawbackTx.Holder = holder;
        }
        // Add optional fee if provided
        if (fee) {
            clawbackTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(clawbackTx);
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
                        issuer: wallet.address,
                        amount: amount,
                        holder: holder || amount.issuer,
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
                    text: `Error performing clawback: ${error instanceof Error
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
// Register deposit-preauth tool
server.tool("deposit-preauth", "Grant or revoke preauthorization for an account to deliver payments to your account", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    authorize: z
        .string()
        .optional()
        .describe("Account address to preauthorize for sending payments to you"),
    authorizeCredentials: z
        .array(z.object({
        issuer: z.string().describe("The issuer of the credential"),
        credentialType: z
            .string()
            .describe("The credential type of the credential (in hex)"),
    }))
        .optional()
        .describe("A set of credentials to authorize (requires Credentials amendment)"),
    unauthorize: z
        .string()
        .optional()
        .describe("Account address whose preauthorization should be revoked"),
    unauthorizeCredentials: z
        .array(z.object({
        issuer: z.string().describe("The issuer of the credential"),
        credentialType: z
            .string()
            .describe("The credential type of the credential (in hex)"),
    }))
        .optional()
        .describe("A set of credentials whose preauthorization should be revoked (requires Credentials amendment)"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, authorize, authorizeCredentials, unauthorize, unauthorizeCredentials, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Validate input - must provide exactly one of the authorization fields
        const providedFields = [
            authorize !== undefined,
            authorizeCredentials !== undefined,
            unauthorize !== undefined,
            unauthorizeCredentials !== undefined,
        ].filter(Boolean).length;
        if (providedFields !== 1) {
            throw new Error("Must provide exactly one of: authorize, authorizeCredentials, unauthorize, or unauthorizeCredentials");
        }
        // Create DepositPreauth transaction
        const depositPreauthTx = {
            TransactionType: "DepositPreauth",
            Account: wallet.address,
        };
        // Add the appropriate authorization field
        if (authorize !== undefined) {
            depositPreauthTx.Authorize = authorize;
        }
        else if (authorizeCredentials !== undefined) {
            depositPreauthTx.AuthorizeCredentials =
                authorizeCredentials.map((cred) => ({
                    Issuer: cred.issuer,
                    CredentialType: cred.credentialType,
                }));
        }
        else if (unauthorize !== undefined) {
            depositPreauthTx.Unauthorize = unauthorize;
        }
        else if (unauthorizeCredentials !== undefined) {
            depositPreauthTx.UnauthorizeCredentials =
                unauthorizeCredentials.map((cred) => ({
                    Issuer: cred.issuer,
                    CredentialType: cred.credentialType,
                }));
        }
        // Add optional fee if provided
        if (fee) {
            depositPreauthTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(depositPreauthTx);
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
                        account: wallet.address,
                        authorize: authorize || undefined,
                        authorizeCredentials: authorizeCredentials || undefined,
                        unauthorize: unauthorize || undefined,
                        unauthorizeCredentials: unauthorizeCredentials || undefined,
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
                    text: `Error setting deposit preauthorization: ${error instanceof Error
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
// Register escrow-cancel tool
server.tool("escrow-cancel", "Cancel an escrow and return escrowed XRP to the sender", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    owner: z
        .string()
        .describe("Address of the source account that funded the escrow payment"),
    offerSequence: z
        .number()
        .describe("Transaction sequence of EscrowCreate transaction that created the escrow to cancel"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, owner, offerSequence, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create EscrowCancel transaction
        const escrowCancelTx = {
            TransactionType: "EscrowCancel",
            Account: wallet.address,
            Owner: owner,
            OfferSequence: offerSequence,
        };
        // Add optional fee if provided
        if (fee) {
            escrowCancelTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(escrowCancelTx);
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
                        account: wallet.address,
                        owner,
                        offerSequence,
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
                    text: `Error cancelling escrow: ${error instanceof Error
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
// Register escrow-create tool
server.tool("escrow-create", "Create an escrow on the XRP Ledger to lock up XRP until specific conditions are met", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    destination: z
        .string()
        .describe("Address of the account that should receive the escrowed XRP"),
    amount: z.string().describe("Amount of XRP, in drops, to escrow"),
    finishAfter: z
        .number()
        .optional()
        .describe("The time, in seconds since the Ripple Epoch, after which the escrow can be finished"),
    cancelAfter: z
        .number()
        .optional()
        .describe("The time, in seconds since the Ripple Epoch, after which the escrow can be cancelled"),
    condition: z
        .string()
        .optional()
        .describe("Hex-encoded PREIMAGE-SHA-256 crypto-condition which must be fulfilled to execute the escrow"),
    destinationTag: z
        .number()
        .optional()
        .describe("Destination tag to specify the beneficiary or purpose at the destination account"),
    sourceTag: z
        .number()
        .optional()
        .describe("Source tag to identify the source or purpose of this escrow"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, destination, amount, finishAfter, cancelAfter, condition, destinationTag, sourceTag, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Validate inputs
        if (!finishAfter && !condition) {
            throw new Error("Either finishAfter or condition must be provided for an escrow");
        }
        // Create EscrowCreate transaction
        const escrowCreateTx = {
            TransactionType: "EscrowCreate",
            Account: wallet.address,
            Destination: destination,
            Amount: amount, // Already in drops format
        };
        // Add optional fields if provided
        if (finishAfter !== undefined) {
            escrowCreateTx.FinishAfter = finishAfter;
        }
        if (cancelAfter !== undefined) {
            escrowCreateTx.CancelAfter = cancelAfter;
        }
        if (condition !== undefined) {
            escrowCreateTx.Condition = condition;
        }
        if (destinationTag !== undefined) {
            escrowCreateTx.DestinationTag = destinationTag;
        }
        if (sourceTag !== undefined) {
            escrowCreateTx.SourceTag = sourceTag;
        }
        if (fee) {
            escrowCreateTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(escrowCreateTx);
        const sequence = prepared.Sequence; // Store the sequence before signing
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
                        account: wallet.address,
                        destination,
                        amount,
                        finishAfter: finishAfter || undefined,
                        cancelAfter: cancelAfter || undefined,
                        condition: condition || undefined,
                        destinationTag: destinationTag || undefined,
                        sourceTag: sourceTag || undefined,
                        sequence, // Use stored sequence
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
                    text: `Error creating escrow: ${error instanceof Error
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
// Register escrow-finish tool
server.tool("escrow-finish", "Finish an escrow and release the escrowed XRP to the recipient", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    owner: z
        .string()
        .describe("Address of the source account that funded the escrow payment"),
    offerSequence: z
        .number()
        .describe("Transaction sequence of EscrowCreate transaction that created the escrow to finish"),
    fulfillment: z
        .string()
        .optional()
        .describe("Hex-encoded fulfillment of the crypto-condition held in the escrow"),
    condition: z
        .string()
        .optional()
        .describe("Hex-encoded crypto-condition. Required when fulfilling a time-based escrow with a crypto-condition"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, owner, offerSequence, fulfillment, condition, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create EscrowFinish transaction
        const escrowFinishTx = {
            TransactionType: "EscrowFinish",
            Account: wallet.address,
            Owner: owner,
            OfferSequence: offerSequence,
        };
        // Add optional fields if provided
        if (fulfillment !== undefined) {
            escrowFinishTx.Fulfillment = fulfillment;
        }
        if (condition !== undefined) {
            escrowFinishTx.Condition = condition;
        }
        if (fee) {
            escrowFinishTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(escrowFinishTx);
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
                        account: wallet.address,
                        owner,
                        offerSequence,
                        fulfillment: fulfillment || undefined,
                        condition: condition || undefined,
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
                    text: `Error finishing escrow: ${error instanceof Error
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
// Register ledger-state-fix tool
server.tool("ledger-state-fix", "Fix specific issues affecting the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    ledgerFixType: z
        .number()
        .describe("The type of fix to apply. Currently only type 1 is supported (fixes NFToken directory)"),
    owner: z
        .string()
        .optional()
        .describe("The account that owns the NFToken directory to fix (required if ledgerFixType is 1)"),
    fee: z
        .string()
        .optional()
        .describe("Transaction fee in XRP (minimum 0.2 XRP)"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, ledgerFixType, owner, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Validate inputs
        if (ledgerFixType !== 1) {
            throw new Error("Currently only ledgerFixType 1 (fix NFToken directory) is supported");
        }
        if (ledgerFixType === 1 && !owner) {
            throw new Error("Owner parameter is required when ledgerFixType is 1");
        }
        // Create LedgerStateFix transaction
        const ledgerStateFixTx = {
            TransactionType: "LedgerStateFix",
            Account: wallet.address,
            LedgerFixType: ledgerFixType,
        };
        // Add owner for NFToken directory fix
        if (ledgerFixType === 1 && owner) {
            ledgerStateFixTx.Owner = owner;
        }
        // Add fee (minimum 0.2 XRP = 200000 drops)
        if (fee) {
            ledgerStateFixTx.Fee = fee;
        }
        else {
            // Default to minimum required fee for LedgerStateFix (0.2 XRP)
            ledgerStateFixTx.Fee = "200000";
        }
        // Submit transaction with failHard enabled to avoid paying fee if transaction fails
        const prepared = await client.autofill(ledgerStateFixTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob, {
            failHard: true,
        });
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
                        account: wallet.address,
                        ledgerFixType,
                        owner: owner || undefined,
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
                    text: `Error fixing ledger state: ${error instanceof Error
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
// Register offer-cancel tool
server.tool("offer-cancel", "Cancel an existing offer on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    offerSequence: z
        .number()
        .describe("The sequence number of the OfferCreate transaction that created the offer to cancel"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, offerSequence, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create OfferCancel transaction
        const offerCancelTx = {
            TransactionType: "OfferCancel",
            Account: wallet.address,
            OfferSequence: offerSequence,
        };
        // Add optional fee if provided
        if (fee) {
            offerCancelTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(offerCancelTx);
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
                        account: wallet.address,
                        offerSequence,
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
                    text: `Error cancelling offer: ${error instanceof Error
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
// Register offer-create tool
server.tool("offer-create", "Create an offer to exchange currencies on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    takerGets: z
        .object({
        currency: z
            .string()
            .describe("Currency code (e.g., 'XRP' or 3-character code)"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer account address (not needed for XRP)"),
        value: z.string().describe("Amount of currency being offered"),
    })
        .describe("The amount and currency being offered"),
    takerPays: z
        .object({
        currency: z
            .string()
            .describe("Currency code (e.g., 'XRP' or 3-character code)"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer account address (not needed for XRP)"),
        value: z
            .string()
            .describe("Amount of currency being requested"),
    })
        .describe("The amount and currency being requested"),
    expiration: z
        .number()
        .optional()
        .describe("Time after which the offer expires (in seconds since Ripple Epoch)"),
    offerSequence: z
        .number()
        .optional()
        .describe("The sequence number of an existing offer to replace"),
    passive: z
        .boolean()
        .optional()
        .describe("If true, offer does not consume offers that exactly match it"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, takerGets, takerPays, expiration, offerSequence, passive, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format amounts
        const formatAmount = (amount) => {
            if (amount.currency.toUpperCase() === "XRP") {
                // Convert from XRP to drops
                return amount.value;
            }
            else {
                return {
                    currency: amount.currency,
                    issuer: amount.issuer,
                    value: amount.value,
                };
            }
        };
        // Create OfferCreate transaction
        const offerCreateTx = {
            TransactionType: "OfferCreate",
            Account: wallet.address,
            TakerGets: formatAmount(takerGets),
            TakerPays: formatAmount(takerPays),
        };
        // Add optional fields if provided
        if (expiration !== undefined) {
            offerCreateTx.Expiration = expiration;
        }
        if (offerSequence !== undefined) {
            offerCreateTx.OfferSequence = offerSequence;
        }
        if (passive === true) {
            offerCreateTx.Flags = 0x00010000; // tfPassive
        }
        if (fee) {
            offerCreateTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(offerCreateTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get the sequence from the prepared transaction
        const sequence = prepared.Sequence;
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        takerGets,
                        takerPays,
                        expiration: expiration || undefined,
                        offerSequence: offerSequence || undefined,
                        passive: passive || undefined,
                        sequence, // Useful for canceling the offer later
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
                    text: `Error creating offer: ${error instanceof Error
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
// Register oracle-delete tool
server.tool("oracle-delete", "Delete an existing price oracle on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create OracleDelete transaction
        const oracleDeleteTx = {
            TransactionType: "OracleDelete",
            Account: wallet.address,
        };
        // Add optional fee if provided
        if (fee) {
            oracleDeleteTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(oracleDeleteTx);
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
                        account: wallet.address,
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
                    text: `Error deleting oracle: ${error instanceof Error
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
// Register payment tool
server.tool("payment", "Send a payment from one account to another on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    destination: z
        .string()
        .describe("Address of the account to receive the payment"),
    amount: z
        .union([
        z.string().describe("Amount of XRP to send (in drops)"),
        z
            .object({
            currency: z.string().describe("Currency code"),
            issuer: z
                .string()
                .optional()
                .describe("Issuer account address (not needed for XRP)"),
            value: z.string().describe("Amount to send"),
            mpt_issuance_id: z
                .string()
                .optional()
                .describe("MPT issuance ID for MPT payments"),
        })
            .describe("Amount to deliver"),
    ])
        .describe("Amount to deliver to the destination"),
    sendMax: z
        .union([
        z.string().describe("Maximum amount of XRP to send (in drops)"),
        z.object({
            currency: z.string().describe("Currency code"),
            issuer: z
                .string()
                .optional()
                .describe("Issuer account address (not needed for XRP)"),
            value: z.string().describe("Maximum amount to send"),
            mpt_issuance_id: z
                .string()
                .optional()
                .describe("MPT issuance ID for MPT payments"),
        }),
    ])
        .optional()
        .describe("Maximum amount of source currency to use"),
    deliverMin: z
        .union([
        z
            .string()
            .describe("Minimum amount of XRP to deliver (in drops)"),
        z.object({
            currency: z.string().describe("Currency code"),
            issuer: z
                .string()
                .optional()
                .describe("Issuer account address (not needed for XRP)"),
            value: z.string().describe("Minimum amount to deliver"),
            mpt_issuance_id: z
                .string()
                .optional()
                .describe("MPT issuance ID for MPT payments"),
        }),
    ])
        .optional()
        .describe("Minimum amount to deliver for partial payments"),
    destinationTag: z
        .number()
        .optional()
        .describe("Destination tag to identify the reason for payment"),
    invoiceId: z
        .string()
        .optional()
        .describe("Arbitrary 256-bit hash representing a specific reason for the payment"),
    paths: z
        .array(z.array(z.any()))
        .optional()
        .describe("Array of payment paths to use for this transaction"),
    credentialIDs: z
        .array(z.string())
        .optional()
        .describe("Set of Credentials to authorize a deposit"),
    partialPayment: z
        .boolean()
        .optional()
        .describe("Allow partial payments - deliver less than the full amount"),
    noRippleDirect: z
        .boolean()
        .optional()
        .describe("Do not use the default path; only use paths included"),
    limitQuality: z
        .boolean()
        .optional()
        .describe("Only take paths with an input:output ratio equal/better than Amount:SendMax"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, destination, amount, sendMax, deliverMin, destinationTag, invoiceId, paths, credentialIDs, partialPayment, noRippleDirect, limitQuality, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Format amount based on type
        const formatAmount = (amountObj) => {
            if (typeof amountObj === "string") {
                // XRP amount in drops
                return amountObj;
            }
            else if (amountObj.mpt_issuance_id) {
                // MPT payment
                return {
                    mpt_issuance_id: amountObj.mpt_issuance_id,
                    value: amountObj.value,
                };
            }
            else if (amountObj.currency.toUpperCase() === "XRP") {
                // XRP in object form - convert to drops
                return amountObj.value;
            }
            else {
                // Other issued currency
                return {
                    currency: amountObj.currency,
                    issuer: amountObj.issuer,
                    value: amountObj.value,
                };
            }
        };
        // Create Payment transaction
        const paymentTx = {
            TransactionType: "Payment",
            Account: wallet.address,
            Destination: destination,
            DeliverMax: formatAmount(amount),
        };
        // Add optional fields if provided
        if (sendMax !== undefined) {
            paymentTx.SendMax = formatAmount(sendMax);
        }
        if (deliverMin !== undefined) {
            paymentTx.DeliverMin = formatAmount(deliverMin);
        }
        if (destinationTag !== undefined) {
            paymentTx.DestinationTag = destinationTag;
        }
        if (invoiceId !== undefined) {
            paymentTx.InvoiceID = invoiceId;
        }
        if (paths !== undefined) {
            paymentTx.Paths = paths;
        }
        if (credentialIDs !== undefined && credentialIDs.length > 0) {
            paymentTx.CredentialIDs = credentialIDs;
        }
        // Set flags
        let flags = 0;
        if (partialPayment === true) {
            flags |= 0x00020000; // tfPartialPayment
        }
        if (noRippleDirect === true) {
            flags |= 0x00010000; // tfNoRippleDirect
        }
        if (limitQuality === true) {
            flags |= 0x00040000; // tfLimitQuality
        }
        if (flags !== 0) {
            paymentTx.Flags = flags;
        }
        if (fee) {
            paymentTx.Fee = fee;
        }
        // Validate payment type rules
        if (typeof amount === "string" && typeof sendMax === "string") {
            throw new Error("Cannot use both XRP for amount and sendMax in a direct XRP payment");
        }
        if (paths && typeof amount === "string" && !sendMax) {
            throw new Error("Paths should not be specified for direct XRP payments");
        }
        // Submit transaction
        const prepared = await client.autofill(paymentTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get delivered amount from metadata if available
        let deliveredAmount = null;
        if (typeof result.result.meta !== "string" &&
            result.result.meta &&
            result.result.meta.delivered_amount) {
            deliveredAmount = result.result.meta.delivered_amount;
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        destination,
                        amount,
                        sendMax: sendMax || undefined,
                        deliverMin: deliverMin || undefined,
                        deliveredAmount: deliveredAmount,
                        destinationTag: destinationTag || undefined,
                        invoiceId: invoiceId || undefined,
                        partialPayment: partialPayment || undefined,
                        noRippleDirect: noRippleDirect || undefined,
                        limitQuality: limitQuality || undefined,
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
                    text: `Error making payment: ${error instanceof Error
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
// Register payment-channel-create tool
server.tool("payment-channel-create", "Create a payment channel to another account on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    destination: z
        .string()
        .describe("Address of the account to receive XRP payments through this channel"),
    amount: z
        .string()
        .describe("Amount of XRP (in drops) to set aside in this channel"),
    settleDelay: z
        .number()
        .describe("Number of seconds the destination must wait to claim XRP after requesting channel closure"),
    publicKey: z
        .string()
        .optional()
        .describe("Public key to use for signing claims against this channel. If omitted, uses ephemeral key pair"),
    cancelAfter: z
        .number()
        .optional()
        .describe("Time after which the channel closes automatically (in seconds since Ripple Epoch)"),
    destinationTag: z
        .number()
        .optional()
        .describe("Destination tag to identify the reason for payment"),
    sourceTag: z
        .number()
        .optional()
        .describe("Source tag to identify the channel creator's reason"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, destination, amount, settleDelay, publicKey, cancelAfter, destinationTag, sourceTag, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create PaymentChannelCreate transaction
        const paymentChannelCreateTx = {
            TransactionType: "PaymentChannelCreate",
            Account: wallet.address,
            Destination: destination,
            Amount: amount,
            SettleDelay: settleDelay,
        };
        // Add optional fields if provided
        if (publicKey !== undefined) {
            paymentChannelCreateTx.PublicKey = publicKey;
        }
        if (cancelAfter !== undefined) {
            paymentChannelCreateTx.CancelAfter = cancelAfter;
        }
        if (destinationTag !== undefined) {
            paymentChannelCreateTx.DestinationTag = destinationTag;
        }
        if (sourceTag !== undefined) {
            paymentChannelCreateTx.SourceTag = sourceTag;
        }
        if (fee) {
            paymentChannelCreateTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(paymentChannelCreateTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Extract the channel ID from the metadata if successful
        let channelID = null;
        if (status === "success" &&
            typeof result.result.meta !== "string" &&
            result.result.meta &&
            result.result.meta.AffectedNodes) {
            // Look for the created channel in the affected nodes
            const affectedNodes = result.result.meta.AffectedNodes;
            for (const node of affectedNodes) {
                if (node.CreatedNode &&
                    node.CreatedNode.LedgerEntryType ===
                        "PayChannel") {
                    channelID = node.CreatedNode.LedgerIndex;
                    break;
                }
            }
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        destination,
                        amount,
                        settleDelay,
                        publicKey: publicKey || undefined,
                        cancelAfter: cancelAfter || undefined,
                        destinationTag: destinationTag || undefined,
                        sourceTag: sourceTag || undefined,
                        channelID,
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
                    text: `Error creating payment channel: ${error instanceof Error
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
// Register payment-channel-claim tool
server.tool("payment-channel-claim", "Claim XRP from a payment channel or request to close it", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    channel: z
        .string()
        .describe("Channel ID of the payment channel to claim from"),
    amount: z
        .string()
        .optional()
        .describe("Amount of XRP (in drops) to claim from the channel"),
    balance: z
        .string()
        .optional()
        .describe("Total amount of XRP delivered by this channel after processing this claim"),
    signature: z
        .string()
        .optional()
        .describe("Signature authorizing the claim (required if claiming as destination)"),
    publicKey: z
        .string()
        .optional()
        .describe("Public key that signed the claim, if using a signature"),
    close: z.boolean().optional().describe("Request to close the channel"),
    renew: z
        .boolean()
        .optional()
        .describe("Request to extend the channel's expiration (source account only)"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, channel, amount, balance, signature, publicKey, close, renew, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create PaymentChannelClaim transaction
        const paymentChannelClaimTx = {
            TransactionType: "PaymentChannelClaim",
            Account: wallet.address,
            Channel: channel,
        };
        // Add optional fields if provided
        if (amount !== undefined) {
            paymentChannelClaimTx.Amount = amount;
        }
        if (balance !== undefined) {
            paymentChannelClaimTx.Balance = balance;
        }
        if (signature !== undefined) {
            paymentChannelClaimTx.Signature = signature;
        }
        if (publicKey !== undefined) {
            paymentChannelClaimTx.PublicKey = publicKey;
        }
        // Set flags
        let flags = 0;
        if (close === true) {
            flags |= 0x00010000; // tfClose
        }
        if (renew === true) {
            flags |= 0x00020000; // tfRenew
        }
        if (flags !== 0) {
            paymentChannelClaimTx.Flags = flags;
        }
        if (fee) {
            paymentChannelClaimTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(paymentChannelClaimTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get information about the payment channel after the claim
        let channelInfo = null;
        try {
            const channelResponse = await client.request({
                command: "ledger_entry",
                index: channel,
                ledger_index: "validated",
            });
            if (channelResponse.result && channelResponse.result.node) {
                channelInfo = channelResponse.result.node;
            }
        }
        catch (error) {
            // Channel might have been closed
            channelInfo = { status: "possibly_closed" };
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        channel,
                        amount: amount || undefined,
                        balance: balance || undefined,
                        close: close || undefined,
                        renew: renew || undefined,
                        channelInfo,
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
                    text: `Error claiming from payment channel: ${error instanceof Error
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
// Register set-regular-key tool
server.tool("set-regular-key", "Assign, change, or remove a regular key pair for an account", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    regularKey: z
        .string()
        .optional()
        .describe("Address of the regular key to assign. If omitted, removes any existing regular key"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, regularKey, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Create SetRegularKey transaction
        const setRegularKeyTx = {
            TransactionType: "SetRegularKey",
            Account: wallet.address,
        };
        // Add optional regularKey if provided
        if (regularKey !== undefined) {
            setRegularKeyTx.RegularKey = regularKey;
        }
        // Add optional fee if provided
        if (fee) {
            setRegularKeyTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(setRegularKeyTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get updated account info
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
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        regularKey: regularKey || "removed",
                        network: useTestnetNetwork
                            ? TESTNET_URL
                            : MAINNET_URL,
                        networkType: useTestnetNetwork
                            ? "testnet"
                            : "mainnet",
                        accountInfo: accountInfo.result.account_data,
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
                    text: `Error setting regular key: ${error instanceof Error
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
// Register signer-list-set tool
server.tool("signer-list-set", "Create, replace, or remove a list of signers that can be used to multi-sign a transaction", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    signerQuorum: z
        .number()
        .describe("Target number for signer weights. Use 0 to delete the signer list"),
    signerEntries: z
        .array(z.object({
        account: z.string().describe("Address of the signer"),
        weight: z
            .number()
            .min(0)
            .max(255)
            .describe("Weight of the signer's signature"),
    }))
        .max(32)
        .optional()
        .describe("Array of signers and their weights (omit when deleting)"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, signerQuorum, signerEntries, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Validate inputs
        if (signerQuorum === 0 &&
            signerEntries &&
            signerEntries.length > 0) {
            throw new Error("When deleting a signer list (signerQuorum = 0), signerEntries must be omitted");
        }
        if (signerQuorum > 0 &&
            (!signerEntries || signerEntries.length === 0)) {
            throw new Error("When creating a signer list, signerEntries must be provided");
        }
        // Calculate total weight to validate quorum
        let totalWeight = 0;
        if (signerEntries) {
            for (const entry of signerEntries) {
                totalWeight += entry.weight;
                // Ensure signer is not the same as account
                if (entry.account === wallet.address) {
                    throw new Error("Account submitting the transaction cannot appear in the signer list");
                }
            }
            // Ensure quorum can be met
            if (signerQuorum > totalWeight) {
                throw new Error(`SignerQuorum (${signerQuorum}) cannot be greater than total weights (${totalWeight})`);
            }
        }
        // Create SignerListSet transaction
        const signerListSetTx = {
            TransactionType: "SignerListSet",
            Account: wallet.address,
            SignerQuorum: signerQuorum,
        };
        // Add signer entries if provided and not deleting
        if (signerQuorum > 0 && signerEntries && signerEntries.length > 0) {
            // Format signer entries for the transaction
            signerListSetTx.SignerEntries = signerEntries.map((entry) => ({
                SignerEntry: {
                    Account: entry.account,
                    SignerWeight: entry.weight,
                },
            }));
        }
        // Add optional fee if provided
        if (fee) {
            signerListSetTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(signerListSetTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get updated account info with the signer list
        let accountInfo = null;
        let signerList = null;
        try {
            accountInfo = await client.request({
                command: "account_info",
                account: wallet.address,
                ledger_index: "validated",
            });
            // If quorum > 0, fetch signer list
            if (signerQuorum > 0 && status === "success") {
                const signerListResponse = await client.request({
                    command: "account_objects",
                    account: wallet.address,
                    ledger_index: "validated",
                    type: "signer_list",
                });
                if (signerListResponse.result.account_objects &&
                    signerListResponse.result.account_objects.length > 0) {
                    signerList =
                        signerListResponse.result.account_objects[0];
                }
            }
        }
        catch (error) {
            console.error("Error fetching updated account info:", error);
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        signerQuorum,
                        signerEntries: signerEntries || [],
                        signerList,
                        network: useTestnetNetwork
                            ? TESTNET_URL
                            : MAINNET_URL,
                        networkType: useTestnetNetwork
                            ? "testnet"
                            : "mainnet",
                        accountInfo: accountInfo?.result.account_data,
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
                    text: `Error setting signer list: ${error instanceof Error
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
// Register ticket-create tool
server.tool("ticket-create", "Set aside one or more sequence numbers as Tickets", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    ticketCount: z
        .number()
        .min(1)
        .max(250)
        .describe("Number of Tickets to create (1-250)"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, ticketCount, fee, useTestnet }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Check current ticket count to ensure we don't exceed the limit
        const accountInfo = await client.request({
            command: "account_info",
            account: wallet.address,
            ledger_index: "validated",
        });
        const currentTicketCount = accountInfo.result.account_data.TicketCount || 0;
        if (currentTicketCount + ticketCount > 250) {
            throw new Error(`Cannot create ${ticketCount} tickets: would exceed the limit of 250 (current count: ${currentTicketCount})`);
        }
        // Create TicketCreate transaction
        const ticketCreateTx = {
            TransactionType: "TicketCreate",
            Account: wallet.address,
            TicketCount: ticketCount,
        };
        // Add optional fee if provided
        if (fee) {
            ticketCreateTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(ticketCreateTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get ticket IDs from the transaction metadata
        let ticketIDs = [];
        if (status === "success" &&
            typeof result.result.meta !== "string" &&
            result.result.meta &&
            result.result.meta.AffectedNodes) {
            // Look for created tickets in the affected nodes
            const affectedNodes = result.result.meta.AffectedNodes;
            for (const node of affectedNodes) {
                if (node.CreatedNode &&
                    node.CreatedNode.LedgerEntryType === "Ticket") {
                    ticketIDs.push(node.CreatedNode.LedgerIndex);
                }
            }
        }
        // Get updated account info
        const updatedAccountInfo = await client.request({
            command: "account_info",
            account: wallet.address,
            ledger_index: "validated",
        });
        // Get tickets associated with the account
        let accountTickets = [];
        try {
            const ticketsResponse = await client.request({
                command: "account_objects",
                account: wallet.address,
                ledger_index: "validated",
                type: "ticket",
            });
            if (ticketsResponse.result.account_objects) {
                accountTickets = ticketsResponse.result.account_objects;
            }
        }
        catch (error) {
            console.error("Error fetching account tickets:", error);
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        ticketCount,
                        ticketIDs,
                        newSequence: updatedAccountInfo.result.account_data
                            .Sequence,
                        updatedTicketCount: updatedAccountInfo.result.account_data
                            .TicketCount || 0,
                        tickets: accountTickets,
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
                    text: `Error creating tickets: ${error instanceof Error
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
// Register trust-set tool
server.tool("trust-set", "Create or modify a trust line linking two accounts", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    limitAmount: z
        .object({
        currency: z.string().describe("Currency code (not XRP)"),
        issuer: z.string().describe("Issuer account address"),
        value: z.string().describe("Limit to set on this trust line"),
    })
        .describe("Object defining the trust line to create or modify"),
    qualityIn: z
        .number()
        .optional()
        .describe("Value incoming balances at the ratio of this number per 1,000,000,000 units"),
    qualityOut: z
        .number()
        .optional()
        .describe("Value outgoing balances at the ratio of this number per 1,000,000,000 units"),
    setAuth: z
        .boolean()
        .optional()
        .describe("Authorize the other party to hold currency issued by this account"),
    setNoRipple: z
        .boolean()
        .optional()
        .describe("Enable the No Ripple flag, which blocks rippling between trust lines"),
    clearNoRipple: z
        .boolean()
        .optional()
        .describe("Disable the No Ripple flag, allowing rippling on this trust line"),
    setFreeze: z.boolean().optional().describe("Freeze the trust line"),
    clearFreeze: z.boolean().optional().describe("Unfreeze the trust line"),
    setDeepFreeze: z
        .boolean()
        .optional()
        .describe("Deep Freeze the trust line"),
    clearDeepFreeze: z
        .boolean()
        .optional()
        .describe("Clear the Deep Freeze on the trust line"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, limitAmount, qualityIn, qualityOut, setAuth, setNoRipple, clearNoRipple, setFreeze, clearFreeze, setDeepFreeze, clearDeepFreeze, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Validate currency - cannot be XRP
        if (limitAmount.currency.toUpperCase() === "XRP") {
            throw new Error("Cannot create a trust line for XRP");
        }
        // Check for conflicting flags
        if (setNoRipple && clearNoRipple) {
            throw new Error("Cannot set and clear the NoRipple flag at the same time");
        }
        if (setFreeze && clearFreeze) {
            throw new Error("Cannot set and clear the Freeze flag at the same time");
        }
        if (setDeepFreeze && clearDeepFreeze) {
            throw new Error("Cannot set and clear the DeepFreeze flag at the same time");
        }
        // Create TrustSet transaction
        const trustSetTx = {
            TransactionType: "TrustSet",
            Account: wallet.address,
            LimitAmount: {
                currency: limitAmount.currency,
                issuer: limitAmount.issuer,
                value: limitAmount.value,
            },
        };
        // Add optional quality settings if provided
        if (qualityIn !== undefined) {
            trustSetTx.QualityIn = qualityIn;
        }
        if (qualityOut !== undefined) {
            trustSetTx.QualityOut = qualityOut;
        }
        // Set flags based on options
        let flags = 0;
        if (setAuth === true) {
            flags |= 0x00010000; // tfSetfAuth
        }
        if (setNoRipple === true) {
            flags |= 0x00020000; // tfSetNoRipple
        }
        if (clearNoRipple === true) {
            flags |= 0x00040000; // tfClearNoRipple
        }
        if (setFreeze === true) {
            flags |= 0x00100000; // tfSetFreeze
        }
        if (clearFreeze === true) {
            flags |= 0x00200000; // tfClearFreeze
        }
        if (setDeepFreeze === true) {
            flags |= 0x00400000; // tfSetDeepFreeze
        }
        if (clearDeepFreeze === true) {
            flags |= 0x00800000; // tfClearDeepFreeze
        }
        if (flags !== 0) {
            trustSetTx.Flags = flags;
        }
        // Add optional fee if provided
        if (fee) {
            trustSetTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(trustSetTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get the updated trust line information
        let trustLine = null;
        if (status === "success") {
            try {
                const linesResponse = await client.request({
                    command: "account_lines",
                    account: wallet.address,
                    peer: limitAmount.issuer,
                    ledger_index: "validated",
                });
                // Find the specific trust line
                if (linesResponse.result.lines &&
                    linesResponse.result.lines.length > 0) {
                    for (const line of linesResponse.result.lines) {
                        if (line.currency === limitAmount.currency) {
                            trustLine = line;
                            break;
                        }
                    }
                }
            }
            catch (error) {
                console.error("Error fetching trust line:", error);
            }
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        limitAmount,
                        qualityIn: qualityIn || undefined,
                        qualityOut: qualityOut || undefined,
                        flags: flags || undefined,
                        trustLine,
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
                    text: `Error setting trust line: ${error instanceof Error
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
// Register nft-mint tool
server.tool("nft-mint", "Create a non-fungible token on the XRP Ledger", {
    fromSeed: z
        .string()
        .optional()
        .describe("Optional seed of the wallet to use. If not provided, the connected wallet will be used."),
    nftokenTaxon: z
        .number()
        .describe("An arbitrary identifier for a collection of related NFTs"),
    issuer: z
        .string()
        .optional()
        .describe("Issuer account (if minting on behalf of another account)"),
    transferFee: z
        .number()
        .min(0)
        .max(50000)
        .optional()
        .describe("Fee for secondary sales (0-50000, representing 0.00%-50.00%)"),
    uri: z
        .string()
        .optional()
        .describe("URI pointing to token metadata (up to 256 bytes, will be converted to hex)"),
    flags: z
        .object({
        burnable: z
            .boolean()
            .optional()
            .describe("Allow the issuer to burn the token"),
        onlyXRP: z
            .boolean()
            .optional()
            .describe("The token can only be bought or sold for XRP"),
        transferable: z
            .boolean()
            .optional()
            .describe("The token can be transferred to others"),
        mutable: z
            .boolean()
            .optional()
            .describe("The URI field can be updated later"),
    })
        .optional()
        .describe("Token flags"),
    amount: z
        .object({
        currency: z.string().describe("Currency code"),
        issuer: z
            .string()
            .optional()
            .describe("Issuer account address"),
        value: z.string().describe("Amount value"),
    })
        .optional()
        .describe("Amount expected for the NFToken"),
    expiration: z
        .number()
        .optional()
        .describe("Time after which the offer is no longer active (seconds since Ripple Epoch)"),
    destination: z
        .string()
        .optional()
        .describe("Account that may accept this offer"),
    memos: z
        .array(z.object({
        memoType: z
            .string()
            .optional()
            .describe("Type of memo (hex encoded)"),
        memoData: z
            .string()
            .optional()
            .describe("Content of memo (hex encoded)"),
        memoFormat: z
            .string()
            .optional()
            .describe("Format of memo (hex encoded)"),
    }))
        .optional()
        .describe("Array of memos to attach to the transaction"),
    fee: z.string().optional().describe("Transaction fee in XRP"),
    useTestnet: z
        .boolean()
        .optional()
        .describe("Whether to use the testnet (true) or mainnet (false). If not provided, uses the network from the connected wallet."),
}, async ({ fromSeed, nftokenTaxon, issuer, transferFee, uri, flags, amount, expiration, destination, memos, fee, useTestnet, }) => {
    let client = null;
    try {
        // Determine which network to use
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
        // Validate inputs
        if (transferFee !== undefined &&
            (!flags || flags.transferable !== true)) {
            throw new Error("TransferFee can only be set if the transferable flag is enabled");
        }
        if ((destination || expiration) && !amount) {
            throw new Error("If destination or expiration is specified, amount must also be specified");
        }
        // Format amount based on type
        const formatAmount = (amountObj) => {
            if (typeof amountObj === "string") {
                // XRP amount in drops
                return amountObj;
            }
            else if (amountObj.mpt_issuance_id) {
                // MPT payment
                return {
                    mpt_issuance_id: amountObj.mpt_issuance_id,
                    value: amountObj.value,
                };
            }
            else if (amountObj.currency.toUpperCase() === "XRP") {
                // XRP in object form - convert to drops
                return amountObj.value;
            }
            else {
                // Other issued currency
                return {
                    currency: amountObj.currency,
                    issuer: amountObj.issuer,
                    value: amountObj.value,
                };
            }
        };
        // Convert URI to hex if provided
        let uriHex = undefined;
        if (uri) {
            // Check if already hex
            if (/^[0-9a-fA-F]+$/.test(uri)) {
                uriHex = uri;
            }
            else {
                // Convert string to hex
                uriHex = Buffer.from(uri).toString("hex");
            }
            // Check length after conversion
            if (uriHex && uriHex.length > 512) {
                throw new Error("URI exceeds maximum length of 256 bytes");
            }
        }
        // Create NFTokenMint transaction
        const nftokenMintTx = {
            TransactionType: "NFTokenMint",
            Account: wallet.address,
            NFTokenTaxon: nftokenTaxon,
        };
        // Add optional fields if provided
        if (issuer) {
            nftokenMintTx.Issuer = issuer;
        }
        if (transferFee !== undefined) {
            nftokenMintTx.TransferFee = transferFee;
        }
        if (uriHex) {
            nftokenMintTx.URI = uriHex;
        }
        // Set flags based on options
        if (flags) {
            let flagsValue = 0;
            if (flags.burnable === true) {
                flagsValue |= 0x00000001; // tfBurnable
            }
            if (flags.onlyXRP === true) {
                flagsValue |= 0x00000002; // tfOnlyXRP
            }
            if (flags.transferable === true) {
                flagsValue |= 0x00000008; // tfTransferable
            }
            if (flags.mutable === true) {
                flagsValue |= 0x00000010; // tfMutable
            }
            if (flagsValue !== 0) {
                nftokenMintTx.Flags = flagsValue;
            }
        }
        // Add offer details if provided
        if (amount) {
            nftokenMintTx.Amount = formatAmount(amount);
        }
        if (expiration !== undefined) {
            nftokenMintTx.Expiration = expiration;
        }
        if (destination) {
            nftokenMintTx.Destination = destination;
        }
        // Add memos if provided
        if (memos && memos.length > 0) {
            nftokenMintTx.Memos = memos.map((memo) => {
                const memoObj = { Memo: {} };
                if (memo.memoType) {
                    memoObj.Memo.MemoType = memo.memoType;
                }
                if (memo.memoData) {
                    memoObj.Memo.MemoData = memo.memoData;
                }
                if (memo.memoFormat) {
                    memoObj.Memo.MemoFormat = memo.memoFormat;
                }
                return memoObj;
            });
        }
        // Add optional fee if provided
        if (fee) {
            nftokenMintTx.Fee = fee;
        }
        // Submit transaction
        const prepared = await client.autofill(nftokenMintTx);
        const signed = wallet.sign(prepared);
        const result = await client.submitAndWait(signed.tx_blob);
        let status = "unknown";
        if (typeof result.result.meta !== "string" && result.result.meta) {
            status =
                result.result.meta.TransactionResult === "tesSUCCESS"
                    ? "success"
                    : "failed";
        }
        // Get the NFToken ID from the transaction metadata
        let nftokenID = null;
        if (status === "success" &&
            typeof result.result.meta !== "string" &&
            result.result.meta &&
            result.result.meta.AffectedNodes) {
            // Look for created NFToken in the affected nodes
            const affectedNodes = result.result.meta.AffectedNodes;
            for (const node of affectedNodes) {
                if (node.ModifiedNode &&
                    node.ModifiedNode.LedgerEntryType ===
                        "NFTokenPage" &&
                    node.ModifiedNode.FinalFields &&
                    node.ModifiedNode.FinalFields.NFTokens) {
                    const previousTokens = (node.ModifiedNode.PreviousFields
                        ?.NFTokens || []).map((t) => t.NFToken.NFTokenID);
                    const finalTokens = (node.ModifiedNode.FinalFields.NFTokens ||
                        []).map((t) => t.NFToken.NFTokenID);
                    // Find new token IDs that weren't in the previous state
                    const newTokenIDs = finalTokens.filter((id) => !previousTokens.includes(id));
                    if (newTokenIDs.length > 0) {
                        nftokenID = newTokenIDs[0];
                        break;
                    }
                }
            }
        }
        // Get account's NFTs
        let accountNFTs = [];
        if (status === "success") {
            try {
                const nftsResponse = await client.request({
                    command: "account_nfts",
                    account: issuer || wallet.address,
                    ledger_index: "validated",
                });
                if (nftsResponse.result.account_nfts) {
                    accountNFTs = nftsResponse.result.account_nfts;
                }
            }
            catch (error) {
                console.error("Error fetching account NFTs:", error);
            }
        }
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        status,
                        hash: result.result.hash,
                        account: wallet.address,
                        issuer: issuer || wallet.address,
                        nftokenTaxon,
                        nftokenID,
                        uri: uriHex,
                        flags: flags || {},
                        accountNFTs,
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
                    text: `Error minting NFT: ${error instanceof Error
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
// Add the main function at the bottom of the file
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("XRPL MCP Server running on stdio");
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
