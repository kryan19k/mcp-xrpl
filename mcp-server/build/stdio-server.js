import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import startServer from "./server/server.js";
import { Wallet } from "xrpl";
import { DEFAULT_SEED } from "./core/constants.js";
import { getXrplClient } from "./core/services/clients.js";
import { setConnectedWallet } from "./core/state.js";
// Import tool files to register them
import "./transactions/connect.js";
import "./transactions/transfer.js";
import "./transactions/deleteAccount.js";
import "./transactions/setAccountProperties.js";
import "./transactions/getAccountInfo.js";
import "./transactions/depositPreauth.js";
import "./transactions/setRegularKey.js";
import "./transactions/token/metadata.js";
import "./transactions/token/balance.js";
import "./transactions/token/transfer.js";
import "./transactions/token/approve.js";
import "./transactions/token/clawback.js";
import "./transactions/nft/metadata.js";
import "./transactions/nft/verifyOwnership.js";
import "./transactions/nft/transfer.js";
import "./transactions/nft/collection.js";
import "./transactions/nft/mint.js";
import "./transactions/did/create.js";
import "./transactions/did/resolve.js";
import "./transactions/did/update.js";
import "./transactions/did/deactivate.js";
import "./transactions/amm/bid.js";
import "./transactions/amm/create.js";
import "./transactions/amm/deposit.js";
import "./transactions/amm/delete.js";
import "./transactions/amm/vote.js";
import "./transactions/amm/clawback.js";
import "./transactions/check/cancel.js";
import "./transactions/check/cash.js";
import "./transactions/check/create.js";
import "./transactions/offer/cancel.js";
import "./transactions/offer/create.js";
import "./transactions/oracle/delete.js";
import "./transactions/oracle/set.js";
import "./transactions/payment/channelClaim.js";
import "./transactions/payment/channelCreate.js";
import "./transactions/payment/channelFund.js";
import "./transactions/payment/payment.js";
import "./transactions/escrow/cancel.js";
import "./transactions/escrow/create.js";
import "./transactions/escrow/finish.js";
import "./transactions/escrow/tokenCreate.js";
import "./transactions/trust/setTrustline.js";
import "./transactions/ticketCreate.js";
import "./transactions/mpt/issuanceCreate.js";
import "./transactions/mpt/issuanceSet.js";
import "./transactions/mpt/issuanceDestroy.js";
import "./transactions/mpt/authorize.js";
import "./transactions/mpt/getInfo.js";
import "./transactions/credentials/create.js";
import "./transactions/credentials/accept.js";
import "./transactions/credentials/delete.js";
import "./transactions/credentials/getInfo.js";
import "./transactions/permissioned-domains/set.js";
import "./transactions/permissioned-domains/delete.js";
import "./transactions/permissioned-domains/getInfo.js";
import "./transactions/batch/submit.js";
import "./transactions/nft/modify.js";
import "./transactions/delegation/set.js";
// Function to automatically connect to XRPL using the seed from .env
async function connectToXrpl() {
    if (!DEFAULT_SEED) {
        console.error("No DEFAULT_SEED found in .env file, skipping automatic connection");
        return;
    }
    try {
        const wallet = Wallet.fromSeed(DEFAULT_SEED);
        console.error("Connecting to XRPL testnet...");
        const client = await getXrplClient(true);
        setConnectedWallet(wallet, true);
        const accountInfo = await client.request({
            command: "account_info",
            account: wallet.address,
            ledger_index: "validated",
        });
        console.error(`Connected to XRPL testnet with wallet: ${wallet.address}`);
        console.error(`Balance: ${accountInfo.result.account_data.Balance} drops`);
        await client.disconnect();
    }
    catch (error) {
        console.error("Error connecting to XRPL:", error);
    }
}
// Start the server in stdio mode
async function main() {
    try {
        console.error("Starting XRPL MCP Server (stdio mode)...");
        const server = await startServer();
        console.error("Connecting to stdio transport...");
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("XRPL MCP Server ready (stdio mode)");
        // Automatically connect to XRPL network
        await connectToXrpl();
        // Keep the process running
        process.on("SIGINT", () => {
            console.error("Shutting down...");
            process.exit(0);
        });
    }
    catch (error) {
        console.error("Error starting MCP server:", error);
        process.exit(1);
    }
}
main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
