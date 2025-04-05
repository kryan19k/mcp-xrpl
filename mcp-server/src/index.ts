import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import startServer from "./server/server.js";

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
import "./transactions/trust/setTrustline.js";
import "./transactions/ticketCreate.js";

// Start the server
async function main() {
    try {
        const server = await startServer();
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("EVM MCP Server running on stdio");
    } catch (error) {
        console.error("Error starting MCP server:", error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
