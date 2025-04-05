import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server/server.js"; // Import the server instance

// Import tool files to register them
import "./transactions/connect.js";
import "./transactions/transfer.js";
import "./transactions/deleteAccount.js";
import "./transactions/setAccountProperties.js";
import "./transactions/getAccountInfo.js";
import "./transactions/token/getTokenMetadata.js";
import "./transactions/token/checkTokenBalance.js";
import "./transactions/token/transferToken.js";
import "./transactions/token/approveTokenSpending.js";
import "./transactions/nft/getNftMetadata.js";
import "./transactions/nft/verifyNftOwnership.js";
import "./transactions/nft/transferNft.js";
import "./transactions/nft/getNftCollection.js";
import "./transactions/did/createDid.js";
import "./transactions/did/resolveDid.js";
import "./transactions/did/updateDid.js";
import "./transactions/did/deactivateDid.js";
import "./transactions/amm/bid.js";
import "./transactions/amm/create.js";
import "./transactions/amm/deposit.js";
import "./transactions/amm/delete.js";
import "./transactions/amm/vote.js";
import "./transactions/amm/info.js";
import "./transactions/amm/withdraw.js";
import "./transactions/check/cancel.js";
import "./transactions/check/cash.js";
import "./transactions/check/create.js";
import "./transactions/offer/cancel.js";
import "./transactions/offer/create.js";
import "./transactions/offer/list.js";
import "./transactions/oracle/delete.js";
import "./transactions/oracle/set.js";
import "./transactions/payment/channelClaim.js";
import "./transactions/payment/channelCreate.js";
import "./transactions/payment/channelFund.js";
import "./transactions/escrow/cancel.js";
import "./transactions/escrow/create.js";
import "./transactions/escrow/finish.js";
import "./transactions/trust/setTrustline.js";
import "./transactions/did/utils.js";

// Main function to start the server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP XRPL server started");
}

main().catch((err) => {
    console.error("Server failed to start:", err);
    process.exit(1); // Exit if server fails to start
});
